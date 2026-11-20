
# AI Agents (in the product)

## 1. Workflow first, agent second
If the steps are known in advance, build a **deterministic workflow** (pipeline of LLM calls + code). Use an
**agent loop** only where the next step genuinely depends on intermediate results. Judges reward agents that
are reliable and inspectable, not agents that wander. Hybrid is common: fixed workflow, with one agentic step.

## 2. Architecture
`POST /runs` creates a run → loop executes steps → each step persisted (`runs`, `steps` tables: type,
tool, args summary, result summary, tokens, latency, status) → events streamed over SSE
(`step_started`, `tool_result`, `needs_approval`, `token`, `done`, `error`) → UI shows a live timeline.
Runs are resumable (state in DB, not in process memory) and have a status:
`queued | running | waiting_approval | succeeded | failed | cancelled`.

## 3. Tools — small, typed, permissioned
```python
import asyncio
from collections.abc import Awaitable, Callable
from pydantic import BaseModel, ValidationError

class ToolResult(BaseModel):
    ok: bool
    data: dict | list | str | None = None
    error: str | None = None
    needs_approval: bool = False

class Tool(BaseModel):
    model_config = {"arbitrary_types_allowed": True}
    name: str
    description: str                       # when to use it, what it returns, limits
    args_model: type[BaseModel]
    handler: Callable[[BaseModel], Awaitable[dict | list | str]]
    side_effect: bool = False              # writes, sends, pays, deletes → needs approval
    timeout_s: float = 10.0

class ToolRegistry:
    def __init__(self, tools: list[Tool]):
        self.tools = {t.name: t for t in tools}

    def schemas(self) -> list[dict]:
        return [{"type": "function", "function": {"name": t.name, "description": t.description,
                 "parameters": t.args_model.model_json_schema()}} for t in self.tools.values()]

    async def execute(self, name: str, raw_args: str, *, approved: bool = False) -> ToolResult:
        tool = self.tools.get(name)
        if tool is None:
            return ToolResult(ok=False, error=f"unknown tool {name}")
        try:
            args = tool.args_model.model_validate_json(raw_args or "{}")
        except ValidationError as e:
            return ToolResult(ok=False, error=f"invalid arguments: {e.errors()[:3]}")
        if tool.side_effect and not approved:
            return ToolResult(ok=False, needs_approval=True, error="requires human approval")
        try:
            return ToolResult(ok=True, data=await asyncio.wait_for(tool.handler(args), tool.timeout_s))
        except TimeoutError:
            return ToolResult(ok=False, error=f"{name} timed out after {tool.timeout_s}s")
        except Exception as e:             # errors go back to the model as data, and to the logs
            log.warning("tool_failed", extra={"fields": {"tool": name, "error": type(e).__name__}})
            return ToolResult(ok=False, error=f"{name} failed: {type(e).__name__}")
```
Tool design rules: one job per tool · descriptive names and descriptions (the model reads them) · compact
results (IDs + key fields, paginate; never dump 50 KB) · idempotent where possible · read tools before write
tools · least-privilege credentials per tool.

## 4. The loop — bounded on every axis
```python
async def run_agent(llm, registry: ToolRegistry, messages: list[dict], *, max_steps: int = 8,
                    deadline_s: float = 90.0) -> dict:
    loop = asyncio.get_running_loop()
    end, seen = loop.time() + deadline_s, set()
    for step in range(max_steps):
        if loop.time() > end:
            return {"status": "failed", "reason": "deadline"}
        msg = await llm.complete_with_tools(messages, tools=registry.schemas())   # adapter returns the raw message
        messages.append(msg.model_dump(exclude_none=True))
        if not msg.tool_calls:
            return {"status": "succeeded", "answer": msg.content, "steps": step + 1}
        for call in msg.tool_calls:
            key = (call.function.name, call.function.arguments)
            if key in seen:                                      # same call twice → stop the spiral
                return {"status": "failed", "reason": f"repeated call {call.function.name}"}
            seen.add(key)
            result = await registry.execute(call.function.name, call.function.arguments)
            if result.needs_approval:
                return {"status": "waiting_approval", "pending": key}   # persist; resume via POST /runs/{id}/approve
            messages.append({"role": "tool", "tool_call_id": call.id, "content": result.model_dump_json()})
    return {"status": "failed", "reason": "max_steps"}
```
Also cap total tokens per run and cost per user. Persist each step before executing the next.

## 5. Memory
Short-term: the run's messages with a rolling summary when over budget. Long-term (only if the feature needs
it): explicit `remember(fact)` tool writing to a store (DB or vector collection) with user scoping; retrieval
by similarity at run start; users can see/delete memories.

## 6. Safety (OWASP LLM Top 10 2026: LLM03 excessive agency, LLM01 prompt injection, LLM06 unbounded consumption)
- Side-effect tools need approval (UI button) or run in dry-run mode for the demo.
- Fetch/browse tools: allow-listed domains, block private/link-local IPs and `file://` (SSRF), size + time limits.
- Code execution: never in the API process. Use a locked-down container/subprocess with CPU/memory/time
  limits and no network, or don't offer it.
- Tool outputs and fetched pages are untrusted data: wrap them, never let them change the system prompt or
  permissions.
- Audit log of every side-effect action (who, what, when, args summary).

## 7. MCP (if TASK.md mentions Model Context Protocol)
Expose product tools as an MCP server with the official Python SDK (`mcp`, FastMCP) reusing the same
`args_model` validation; or consume external MCP servers as tools through the registry with the same
permission and timeout rules. Keep stdio servers out of the request path. Building an MCP server → load the
optional `mcp-builder` skill (LEAD installs it with `--only mcp`).

## 8. Frameworks
Default: the plain loop above (transparent, debuggable). Use LangGraph / OpenAI Agents SDK / Google ADK only
when TASK.md asks or the control flow is a real graph with branches and checkpoints; pin versions and keep
tools/prompt files framework-independent.

## 9. Evals and done checklist
Scenario set (≥ 10) with expected outcomes and allowed tools → success rate, avg steps, tool-error rate,
cost/run, p95 latency; include adversarial cases (injection inside a tool result, impossible task → graceful
failure). Done = bounded loop · validated tool args · approvals for side effects · persisted steps · SSE
timeline · evals in the report.
