"""LLM access via the locally-authenticated Gemini CLI — no API key needed.

Mirrors the spec-project `gemini_cli` provider: the prompt is piped to the
`gemini` CLI in JSON output mode and the model's text is pulled from the
`response` field. Requires the `gemini` CLI to be installed and logged in.
"""
from __future__ import annotations

import asyncio
import json
import re

DEFAULT_MODEL = "gemini-2.5-flash"


class GeminiCLIError(RuntimeError):
    """Raised when the Gemini CLI fails after all retries."""


class GeminiCLIProvider:
    def __init__(self, model: str = DEFAULT_MODEL, max_retries: int = 3) -> None:
        self.model = model
        self.max_retries = max_retries

    async def complete(self, prompt: str) -> str:
        """Run the prompt through the Gemini CLI and return its text response."""
        last_error = ""
        for attempt in range(1, self.max_retries + 1):
            proc = await asyncio.create_subprocess_exec(
                "gemini", "-", "--output-format", "json", "-m", self.model,
                stdin=asyncio.subprocess.PIPE,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
            )
            stdout, stderr = await proc.communicate(input=prompt.encode())
            if proc.returncode == 0:
                return self._extract(stdout.decode())
            last_error = stderr.decode()[:500]
            if attempt < self.max_retries:
                await asyncio.sleep(3 * attempt)
        raise GeminiCLIError(f"gemini CLI failed: {last_error}")

    @staticmethod
    def _extract(raw_stdout: str) -> str:
        data = json.loads(raw_stdout)
        return GeminiCLIProvider._strip_fences(data.get("response", ""))

    @staticmethod
    def _strip_fences(text: str) -> str:
        text = text.strip()
        match = re.match(r"^```(?:json)?\s*\n?(.*?)\n?\s*```$", text, re.DOTALL)
        return match.group(1).strip() if match else text
