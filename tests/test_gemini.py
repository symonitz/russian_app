import asyncio
import json

from ruslearn.gemini_cli import GeminiCLIProvider


def test_strip_fences_removes_json_block():
    raw = '```json\n{"a":1}\n```'
    assert GeminiCLIProvider._strip_fences(raw) == '{"a":1}'


def test_strip_fences_passthrough_when_no_fence():
    assert GeminiCLIProvider._strip_fences('{"a":1}') == '{"a":1}'


def test_extract_pulls_response_field_and_strips():
    raw = json.dumps({"response": '```json\n{"x":2}\n```', "stats": {}})
    assert GeminiCLIProvider._extract(raw) == '{"x":2}'


def test_complete_shells_out_and_returns_response(monkeypatch):
    captured = {}

    class _FakeProc:
        returncode = 0

        async def communicate(self, input=None):
            captured["input"] = input
            return (json.dumps({"response": "Привет"}).encode(), b"")

    async def _fake_exec(*args, **kwargs):
        captured["args"] = args
        return _FakeProc()

    monkeypatch.setattr(asyncio, "create_subprocess_exec", _fake_exec)
    out = asyncio.run(GeminiCLIProvider().complete("say hi"))
    assert out == "Привет"
    assert captured["args"][0] == "gemini"
    assert captured["input"] == b"say hi"
