# Semble integration affordances

This document records the Semble contracts that determine Code Intelligence
indexing and retrieval. It covers Semble `0.5.2`, the version executed by the
MCP package, and upstream commit
`906319556a46bca45d8809b4733e05dd51cd5ba2` from 2026-07-22.

## Runtime identity

```sh
uvx --from 'semble[mcp]==0.5.2' python -c \
  'import semble, pathlib; print(pathlib.Path(semble.__file__).resolve()); print(semble.__version__)'
```

```text
/Users/tylermitchell/.cache/uv/archive-v0/F_R4tLPIjVS7bzmuueFTZ/lib/python3.12/site-packages/semble/__init__.py
0.5.2
```

```sh
git -C /tmp/semble-upstream-main log -1 --format='%H%n%cI%n%s'
```

```text
906319556a46bca45d8809b4733e05dd51cd5ba2
2026-07-22T12:19:16+02:00
[feat] add version to semble command in mcp and instructions (#229)
```

Status: observed

## Documentation contradiction: no file watcher

The current README says:

```text
In MCP mode, a file watcher detects changes and triggers a rebuild
automatically so the index is always current within the same session.
```

No watcher dependency or watcher implementation exists in the installed
package or current upstream source. The only freshness path is
`_IndexCache._evict_if_stale`, invoked by a later `get()` call after the
build-duration cooldown. Repository tests likewise describe call-time
revalidation, not pushed invalidation.

The same README says a changed index is “fully rebuilt.” Current source instead
loads compatible prior state and reuses unchanged file chunks, vectors, and
BM25 postings.

Code Intelligence consequence:

- Source behavior, not the README claim, defines freshness expectations.
- The existing long-lived process receives edits without manual notification,
  but a request made inside the cooldown can still observe the prior index.
- No additional watcher should be invented under the assumption that Semble
  already exposes one.

Status: source-confirmed contradiction

## Current Code Intelligence seam

```ts
// packages/code-intelligence-mcp/src/semble.ts
const transport = new StdioClientTransport({
  command: "uvx",
  args: ["--from", "semble[mcp]==0.5.2", "semble"],
  env: {
    ...getDefaultEnvironment(),
    ...sembleEnvironment,
  },
  stderr: "ignore",
})

await (state.connection ??= client.connect(transport))
return client.callTool(
  { name: input.name, arguments: input.arguments },
  { signal: input.signal },
)
```

One official MCP client and stdio transport are created per Code Intelligence
process. Connection is lazy, then reused by every intelligence tool. Shutdown
closes both the Code Intelligence server and its Semble child. The dependency
is pinned to the audited release. The transport begins with the MCP SDK's safe
default child environment and forwards every defined `SEMBLE_*` variable from
the Code Intelligence process. It does not forward unrelated credentials or
shell state.

```ts
// packages/code-intelligence-mcp/src/intelligence.ts
const searchRoot = resolveSearchRoot(request.root, request.scope)
const page = await semble.search({
  repo: searchRoot,
  query: request.query,
  limit: request.limit,
  snippetLines: request.snippetLines,
  signal: request.signal,
})
```

The workspace root is the default Semble repository. An explicit `scope`
becomes a distinct Semble repository root, after a Volar-provided containment
check. Semble result paths are resolved from that search root and displayed
relative to the outer workspace.

The enrichment layer asks the Volar workspace for document symbols and
optional hover information. It does not alter Semble indexing, chunking,
ranking, freshness, or cache behavior.

Status: runtime-proven on macOS

## Adopted public affordances

```text
Semble MCP max_snippet_lines = None   -> full chunk
Code Intelligence snippetLines       -> integer 0..30 or null

Semble local chunk path on Windows    -> native pathlib separator
Code Intelligence related seed path  -> native node:path separator
```

`snippetLines: null` now passes Semble's complete-chunk mode through every
intelligence tool. Defaults remain bounded.

`related_code` now derives the seed with the platform-native `node:path`
`relative` function. The previous `pathe.relative` always emitted `/`, while
Python's Windows `Path.relative_to` stores `\`:

```text
pathe.relative(...)          src/file.ts
node:path.win32.relative(...) src\file.ts
PureWindowsPath.relative_to   src\file.ts
```

The built MCP accepted `snippetLines: null` and returned the complete 20-line
Semble chunk. A scoped `related_code` call then resolved that result and
returned two complete related chunks.

Status: runtime-proven on macOS; Windows separator contract source-proven

## Model prewarming decision

Two fresh official Semble MCP processes queried the same persisted scope:

```text
immediate call   connect 1028 ms   search 1121 ms
2 s prewarm      connect  475 ms   search  858 ms
```

Semble correctly opens stdio before its background model load and makes the
first search await readiness. Code Intelligence currently launches that child
lazily on the first intelligence-tool call.

Eagerly launching Semble for every Code Intelligence process would shift about
one second away from the first retrieval on this machine, but would also load a
Python worker and model for agents that use only Volar tools. With several
parallel agents, that permanent default cost is greater than the observed
one-time benefit. The lazy official-MCP connection is retained.

Status: runtime-proven on macOS

## Concurrent cold-build observation

Three independent built Code Intelligence MCP processes called `search_code`
at the same time against a previously uncached copy of
`packages/webgpu-pipeline`.

```text
workspace  /private/tmp/semble-cold-concurrency.u3sgrn
files      152 indexed
calls      3 concurrent MCP sessions
elapsed    3354 ms wall time
outcome    3 successful result pages
cache      3.9 MiB
```

The shared persisted cache was readable by a fourth fresh MCP process, which
returned the same primary result. Its required components were present and
consistent:

```text
semantic_index/vectors.npy   1,741,952 bytes
bm25_index/index.json        1,054,364 bytes
chunks.json                  1,219,775 bytes
metadata.json                   14,540 bytes

cache_version  1
model          minishlab/potion-code-16M-v2
content        code
chunk_size     750
```

This demonstrates convergence for identical simultaneous cold builds on this
machine. It does not make the upstream in-place write sequence atomic; a
process crash during persistence remains an upstream corruption risk.

Status: runtime-proven on macOS

## Cache recovery boundary

The built Code Intelligence MCP was launched with an isolated
`SEMBLE_CACHE_LOCATION`. A search created all six expected Semble files there,
establishing that environment configuration reaches the real child process.

Removing `chunks.json` and starting a fresh MCP process caused Semble to rebuild
the incomplete index and return a normal search result:

```text
incomplete cache   search succeeded
chunks.json        recreated
```

Replacing `metadata.json` with malformed JSON produced Semble's native error:

```text
Failed to index '/tmp/semble-cold-concurrency.u3sgrn':
Expecting value: line 2 column 1 (char 12)
```

Thus Semble recovers from a missing required component, metadata mismatch, and
structurally invalid incremental state, but does not recover from malformed
complete-cache JSON encountered by `get_validated_cache`. Code Intelligence
must preserve that failure rather than inventing cache mutation or deletion
policy outside Semble.

Status: runtime-proven on macOS

## Cancellation and disposal

A fresh scoped request was aborted through the official MCP client's
`AbortSignal`:

```text
SdkError: Error: cancel indexing request
```

The same Code Intelligence process immediately served a successful hot scoped
query afterward. This matches Semble's shielded index-build task: cancelling one
request does not poison the connection or cancel shared index construction.

A uniquely titled built Code Intelligence process was connected through the
official MCP client and stdio transport. Closing the client and transport
removed that process immediately. The server's stdin-end and signal handlers
close the MCP handle, Volar workspaces, and the Semble client.

Status: runtime-proven on macOS

## Monorepo scope cost

One MCP process searched five explicit scopes in `kek-monorepo`. Each produced
an independent native Semble index:

```text
scope                         indexed files   persisted size
packages/webgpu-engine                 1209       40.97 MiB
apps/ardy                               207        7.15 MiB
packages/webgpu-pipeline                152        3.86 MiB
packages/tensor-fabric                  166        4.79 MiB
packages/world-engine                    26        0.77 MiB
                                                    --------
total                                               57.54 MiB
```

An existing whole-monorepo index contained 4,900 files and occupied 138 MiB.
Scoped indexes therefore improve retrieval locality and reduce the active
in-memory corpus, but duplicate persisted chunks and vectors already present in
the root index. Each distinct scope also occupies one of Semble's ten
process-local LRU entries.

After reusing the largest scope, the measured RSS for the complete process tree
that had opened both the disposable package and `kek-monorepo` was:

```text
Code Intelligence MCP       19.1 MiB
Semble uv launcher           4.6 MiB
Semble Python worker        27.6 MiB
language server: temp root   7.0 MiB
language server: kek root   25.3 MiB
total                       83.6 MiB
```

The hot scoped query completed in 311 ms through the full built MCP path.

Decision:

- Keep the workspace root as the default index.
- Retain `scope` as an explicit retrieval-locality control, not a required
  argument or an automatically generated index.
- Make its separate-index cost visible in tool metadata so agents do not
  generate many arbitrary scope identities.
- Do not build a second index registry; Semble's canonical-path cache and LRU
  remain authoritative.

Status: runtime-proven on macOS

## Same-session file convergence

One of those MCP processes remained alive while an external patch created,
changed, renamed, and deleted a TypeScript file in the disposable repository.
The next `search_code` call observed each state:

```text
create  src/semble-freshness-probe.ts
change  publishFreshnessSentinel -> convergeChangedIndexSentinel
rename  src/renamed-freshness-probe.ts
delete  deleted path absent from the next five-result page
```

No manual freshness notification or process restart was used. These operations
were far enough apart for the small repository's build-time cooldown to elapse;
the source-defined cooldown boundary still applies.

Status: runtime-proven on macOS

## Remote repository behavior

```python
# Source: Semble 0.5.2, src/semble/index/index.py — from_git
cmd = [
    "git", "clone", "--depth", "1",
    *(["--branch", ref] if ref else []),
    "--", url, tmp_dir,
]
```

The Python API can select a branch or tag and reads
`SEMBLE_CLONE_TIMEOUT` (default 60 seconds). The public MCP exposes no `ref`
argument and accepts only HTTP(S) URLs; file, SSH, Git, and SCP-like transports
are rejected before cloning.

Remote indexes skip file-tree validation entirely after persistence. Reusing the
same URL therefore reuses the cached snapshot without checking the remote HEAD.
The public MCP has no per-repository refresh or eviction operation.

Code Intelligence consequence:

- Combined Semble+Volar tools remain local-workspace tools.
- Remote search belongs to Semble's standalone MCP surface, where results
  cannot be enriched with the local language server and may represent a cached
  remote snapshot.

Status: observed

## Installed release versus upstream main

```sh
git -C /tmp/semble-upstream-main diff --stat v0.5.2..HEAD
```

```text
docs/installation.md              |  4 ++
src/semble/cli.py                 |  6 ++-
src/semble/installer/agents.py    | 48 +++++++++++++++++----
src/semble/installer/config.py    |  4 +-
src/semble/installer/installer.py |  3 +-
tests/test_cli.py                 | 11 +++++
tests/test_installer.py           | 88 +++++++++++++++++++++++++++++++++++++++
```

The installed package matches tag `v0.5.2` across the MCP, cache, index,
chunking, search, ranking, model, file, and statistics modules. Current main
adds a `semble --version` command and version-pinned generated installation
configuration. It does not change retrieval or indexing behavior.

Code Intelligence already launches the exact version
`semble[mcp]==0.5.2`, so the one relevant upstream-main change—avoiding an
unpinned runtime dependency—is already present.

Status: observed

The `v0.5.2` release notes contain one runtime change:

```text
feat: Add partial reindexing
```

That is the manifest/vector/BM25 reuse path described above. Earlier relevant
release notes establish that `v0.4.1` added MCP cache validation on query and
`v0.4.0` flattened MCP results while removing redundant language/location
fields. There is no newer released indexing capability omitted by the pinned
integration.

Source: GitHub releases for `MinishLab/semble`, retrieved 2026-07-25.

Status: observed

## Usage statistics

```python
# Source: Semble 0.5.2, src/semble/stats.py
record = {
    "ts": datetime.now(timezone.utc).timestamp(),
    "call": call_type,
    "results": len(results),
    "snippet_chars": snippet_chars,
    "file_chars": file_chars,
}
```

Every Python `search` and `find_related` call attempts to append a record to
the shared `savings.jsonl` in the Semble cache directory. On platforms with
`fcntl`, the append uses a non-blocking exclusive lock and silently skips the
record on contention. Platforms without `fcntl`, including Windows, append
without that lock. Statistics errors never fail search.

The CLI's “token savings” are an estimate from returned snippet characters
versus complete characters in the distinct result files, divided by four. They
are not model-token measurements and are not an index-health signal.

Code Intelligence consequence:

- No agent-facing tool should expose these administrative estimates as code
  intelligence.
- The unavoidable stats append is best-effort and independent of index
  persistence.

Status: observed

## Hybrid retrieval and score meaning

```python
# Source: Semble 0.5.2, src/semble/search.py
candidate_count = top_k * 5
semantic = _search_semantic(query, ..., candidate_count, selector)
bm25 = _search_bm25(query, ..., candidate_count, selector)

normalized_semantic = _rrf_scores(semantic_scores)
normalized_bm25 = _rrf_scores(bm25_scores)
combined = (
    alpha * normalized_semantic
    + (1.0 - alpha) * normalized_bm25
)
```

Semble over-fetches five times the requested result count from both dense and
BM25 retrieval. Each source's raw scores are discarded and replaced with
reciprocal-rank-fusion values `1 / (60 + rank)`. The two ranks are then blended.

Automatic weighting is:

```text
bare symbol or qualified identifier   semantic 0.3 / BM25 0.7
natural-language query                semantic 0.5 / BM25 0.5
```

The returned score is a ranking artifact after RRF, boosts, penalties, and file
saturation. It is not a probability, confidence, cosine similarity, or stable
cross-query relevance threshold. Dense retrieval can still return a result when
no lexical term matches, so nonsensical queries do not necessarily produce an
empty result.

Code Intelligence consequence:

- Do not label or threshold the score as confidence.
- Omission of the raw numeric score from the agent-facing combined tools avoids
  presenting false precision.
- Search results must remain explicitly “retrieved candidates” until Volar
  establishes an exact code relationship.

Status: observed

## Code reranking

When `code` is present in the index, the Python API enables reranking by
default:

```python
# Source: Semble 0.5.2, src/semble/index/index.py
resolved_rerank = (
    ContentType.CODE in self._content
    if rerank is None
    else rerank
)
```

The reranker:

- boosts the best chunk in files with several high-scoring candidates;
- detects bare symbol queries and strongly boosts matching definitions;
- detects CamelCase or camelCase symbols embedded in natural-language queries;
- boosts matches in file stems and immediate parent directories;
- adds the file stem twice and the last three directory components to BM25;
- penalizes test/spec paths, compatibility code, examples, declaration files,
  and selected package metadata paths when the query is not purely semantic;
- decays additional chunks from the same file so one file does not monopolize
  the page.

These are already code-oriented ranking affordances. Reimplementing path,
symbol, test, or file-diversity heuristics in Code Intelligence would duplicate
Semble.

Status: observed

## Model execution

```python
# Source: Semble 0.5.2, src/semble/index/dense.py
@cache
def _load_cached(model_path: str) -> StaticModel: ...

model.encode(
    [chunk.content for chunk in chunks],
    use_multiprocessing=False,
)
```

The model object is cached by resolved model identity inside each Python
process. Index embedding explicitly disables Model2Vec multiprocessing.
Semantic queries encode one query and use the in-memory cosine backend.

Code Intelligence consequence:

- Semble does not create a worker pool per index build.
- Parallel Codex agents still each own one Semble process and one model object.
- Sharing a model across MCP processes is not an exposed Semble affordance.

Status: observed

## Chunking and source coordinates

```python
# Source: Semble 0.5.2, src/semble/chunking/chunking.py
_DESIRED_CHUNK_LENGTH_CHARS = 750

if language is not None and is_supported_language(language):
    chunk_boundaries = chunk(source, language, _DESIRED_CHUNK_LENGTH_CHARS)
if chunk_boundaries is None:
    chunk_boundaries = chunk_lines(source, _DESIRED_CHUNK_LENGTH_CHARS)
```

Semble asks Tree-sitter for syntax boundaries, recursively splits large nodes,
and merges adjacent nodes up to a desired 750 characters. Parser lookup is
cached per language. Missing or failed parsers use line-grouped chunks instead.
The 750-character value is internal and explicitly not configurable.

Tree-sitter byte offsets are converted back to Python character offsets before
slicing source. Stored locations are 1-based inclusive `start_line` and
`end_line`. `max_snippet_lines` changes only rendered output and token-savings
accounting; it does not change indexing or ranking.

```python
# Source: Semble 0.5.2, src/semble/utils.py — resolve_chunk
if (
    chunk.file_path == file_path
    and chunk.start_line <= line <= chunk.end_line
):
    if line < chunk.end_line:
        return chunk
    fallback = chunk
```

At a shared end/start line boundary, `find_related` prefers the chunk beginning
there and retains the ending chunk only as a fallback. The file path must match
the repo-relative indexed path exactly.

Status: observed

## Lexical tokens

```python
# Source: Semble 0.5.2, src/semble/tokens.py
"HandlerStack" -> ["handlerstack", "handler", "stack"]
"my_func"      -> ["my_func", "my", "func"]
```

BM25 receives identifier-shaped tokens only. CamelCase, PascalCase, and
snake_case identifiers retain their complete lowercase token and add component
tokens. This is why symbol names and plain behavior descriptions can both
participate in hybrid retrieval.

Status: observed

## Eligible files and ignore rules

```python
# Source: Semble 0.5.2, src/semble/index/file_walker.py
for item in sorted(directory.iterdir()):
    if item.is_symlink():
        continue
    is_ignored, forced_include = _is_ignored(item, inherited_specs)
    if is_ignored:
        continue
    if item.is_dir():
        yield from _walk(item, inherited_specs, extensions)
    elif item.is_file() and (
        forced_include or item.suffix.lower() in extensions
    ):
        yield item
```

Each directory contributes its own `.gitignore` and `.sembleignore` patterns to
descendants. Semble also always excludes common VCS, dependency, environment,
cache, and build directories, including `.git`, `node_modules`, `.venv`,
`.cache`, `.semble`, `.next`, `dist`, and `build`.

A negated ignore pattern ending in a file extension, such as `!*.proto`, can
force files past the configured content-type extension filter. Symlinks are
never followed. Traversal is sorted, which stabilizes manifest and chunk order.

```python
# Source: Semble 0.5.2, src/semble/index/files.py — get_file_status
if file_path.stat().st_size > 1_000_000:
    return FileStatus.TOO_LARGE
if size < 128 and not read_file_text(file_path).strip():
    return FileStatus.EMPTY
```

Files larger than one megabyte and empty files are skipped. Text is decoded as
UTF-8 with replacement for invalid bytes.

Status: observed

## Content classification

Semble derives content sets from its extension-to-language table:

```python
# Source: Semble 0.5.2, src/semble/index/files.py
_CODE_LANGUAGES = (
    ALL_LANGUAGES - _DOC_LANGUAGES - _CONFIG_LANGUAGES - _DATA_LANGUAGES
)

_CONTENT_TYPE_LANGUAGES = {
    ContentType.CODE: _CODE_LANGUAGES,
    ContentType.DOCS: _DOC_LANGUAGES,
    ContentType.CONFIG: _CONFIG_LANGUAGES,
}
```

TypeScript, TSX, JavaScript, WGSL, CSS, and other executable languages belong
to `code`. Markdown belongs to `docs`. TOML, YAML, XML, `.gitignore`, protobuf,
and similar formats belong to `config`.

JSON, JSON5, CSV, PSV, and TSV are classified as data and are not assigned to
any public content type. Consequently, even `--content all` does not index
them unless a `.sembleignore` negation explicitly forces their inclusion.

Code Intelligence consequence:

- `code` is the coherent content set for the current implementation-oriented
  retrieval tools.
- `all` would add documentation and configuration but still would not provide
  general JSON retrieval.
- File reading and language-service support for Markdown or JSON are separate
  concerns from Semble's retrieval index.

Status: observed

## Incremental rebuild granularity

```python
# Source: Semble 0.5.2, src/semble/index/create.py
if previous_entry is not None and previous_entry.mtime_ns == mtime_ns:
    file_chunks = previous.chunks[previous_entry.start : previous_entry.end]
    vector_parts.append(previous.vectors[previous_entry.start : previous_entry.end])
else:
    file_chunks = chunk_source(source, indexed_path, language)
    _reindex_file(bm25_index, indexed_path, file_chunks, previous_entry)
    vector_parts.append(embed_chunks(model, file_chunks))
```

Unchanged files reuse their prior chunks and dense vectors by exact nanosecond
mtime. Changed or new files are re-read, re-chunked, re-embedded, and replace
their BM25 postings. Deleted files have their old BM25 documents removed. If
all per-file chunk ranges remain identical, Semble updates the previous dense
matrix in place; otherwise it stacks the retained and new vector parts.

The incremental unit is one file, not one changed function.

Status: observed

## Persisted cache identity and location

```python
# Source: Semble 0.5.2, src/semble/cache.py
subdir_path = hashlib.new("sha256", canonical_source.encode("utf-8")).hexdigest()
cache_dir = resolve_cache_folder() / subdir_path
return cache_dir / "index"
```

Local cache identity is the SHA-256 of `Path(path).expanduser().resolve()`.
Git URL identity is the literal URL, with `@ref` appended by callers when a ref
is present. A repository root and each scoped subdirectory therefore have
separate persisted indexes.

```text
macOS   ~/Library/Caches/semble
Linux   ${XDG_CACHE_HOME:-~/.cache}/semble
Windows ${LOCALAPPDATA:-${APPDATA:-~/AppData/Local}}/semble/Cache
custom  $SEMBLE_CACHE_LOCATION
```

`SEMBLE_CACHE_LOCATION` is honored only when it is absolute. The standard
platform paths are implemented with `pathlib.Path`; Code Intelligence does not
need platform-specific path construction.

Status: observed

## Cache validation and incremental reuse

```python
# Source: Semble 0.5.2, src/semble/cache.py — _metadata_matches
return (
    metadata["model_path"] == model_path
    and set(content_type) == set(content)
    and metadata.get("chunk_size") == _DESIRED_CHUNK_LENGTH_CHARS
    and metadata.get("cache_version") == CACHE_FORMAT_VERSION
)
```

A persisted index is reusable only when model identity, content types, chunk
size, and cache format match. For a local source, Semble then walks the current
eligible file set, rejects files newer than the index write time, and requires
the current paths to equal the stored manifest paths.

When the complete cache is stale but structurally compatible,
`load_previous_for_incremental` loads chunks, dense vectors, the BM25 index, and
the file manifest. It verifies aligned document counts, contiguous per-file
chunk ranges, and stable BM25 document IDs before returning the previous state.
The next index build can then reuse unchanged file chunks and vectors.

Malformed incremental state is treated as unavailable and rebuilt. This
recovery is narrower than complete-cache loading: the initial
`get_validated_cache` path does not catch malformed JSON or filesystem errors.

Status: observed

## Persistence concurrency boundary

```python
# Source: Semble 0.5.2, src/semble/index/index.py — SembleIndex.save
self._bm25_index.save(path / "bm25_index")
self._semantic_index.save(path / "semantic_index")
(path / "chunks.json").write_bytes(orjson.dumps(self.chunks))
(path / "metadata.json").write_bytes(orjson.dumps(metadata))
```

The four components are written in place. There is no temporary directory,
atomic rename, or cross-process lock around index persistence. The metadata
file is written last, but two MCP processes can still write the same cache
directory concurrently.

This is a genuine upstream boundary rather than an integration-owned indexing
concern. Identical simultaneous cold builds converged in the multi-process
observation above, while malformed complete-cache JSON did not recover. Code
Intelligence should not duplicate Semble persistence to compensate.

Status: source-observed and runtime-proven on macOS

## Lower-level Python search surface

```python
# Source: Semble 0.5.2, src/semble/index/index.py — SembleIndex.search
def search(
    self,
    query: str,
    top_k: int = 10,
    alpha: float | None = None,
    filter_languages: list[str] | None = None,
    filter_paths: list[str] | None = None,
    rerank: bool | None = None,
    max_snippet_lines: int | None = None,
) -> list[SearchResult]: ...
```

The Python API exposes capabilities absent from the MCP:

- explicit semantic/BM25 blend weight;
- exact language selectors;
- exact repository-relative file selectors;
- explicit code reranking control;
- index statistics (`indexed_files`, `total_chunks`, language counts).

Selectors are built from exact file and language lookup tables. `filter_paths`
does not express directory prefixes or globs, so it is not a drop-in
replacement for searching a scoped subtree.

`find_related` is semantic-only and automatically selects the seed chunk's
language when that chunk has one. It removes the seed itself and returns the
next `top_k` matches.

Code Intelligence consequence:

- Passing a scoped directory as the public MCP `repo` remains Semble's only
  native subtree boundary.
- Reaching these Python-only controls would require replacing the official MCP
  process seam. None currently has enough proven value to justify that.

Status: observed

## Coverage map

| Build need | Owning Semble source | Current status |
| --- | --- | --- |
| Public MCP lifecycle and tools | `src/semble/mcp.py` | observed |
| CLI configuration and content selection | `src/semble/cli.py` | observed |
| Index creation and incremental reuse | `src/semble/index/create.py` | source-observed; create/change/rename/delete runtime-proven |
| In-memory index and persistence | `src/semble/index/index.py` | source-observed; concurrent persistence runtime-proven |
| Cache validation and cross-platform paths | `src/semble/cache.py` | source-observed; recovery runtime-proven; Windows paths source-proven |
| File classification and ignore rules | `src/semble/index/files.py`, `file_walker.py` | observed |
| Chunking and source ranges | `src/semble/chunking/*` | observed |
| Hybrid search, weighting, and reranking | `src/semble/search.py`, `ranking/*` | observed |
| Selectors and related-code behavior | `src/semble/index/index.py` | observed |
| Model loading and process cost | `src/semble/index/dense.py`, `mcp.py` | source-observed and measured |
| Statistics and configuration | `src/semble/stats.py`, `utils.py`, `cli.py` | observed |
| Code Intelligence integration consequences | `packages/code-intelligence-mcp/src/semble.ts`, `intelligence.ts` | implemented and runtime-proven |

The retained integration keeps Semble behind its official MCP process, one
lazy child per Code Intelligence process, with root indexing by default and
explicit stable scopes available for retrieval locality.

## Public MCP surface

Semble's entire public MCP surface is two read-only tools:

```python
# Source: Semble 0.5.2, src/semble/mcp.py — create_server
@server.tool()
async def search(
    query: str,
    repo: str,
    top_k: int = 5,
    max_snippet_lines: int | None = 10,
) -> str: ...

@server.tool()
async def find_related(
    file_path: str,
    line: int,
    repo: str,
    top_k: int = 5,
    max_snippet_lines: int | None = 10,
) -> str: ...
```

`repo` accepts a local directory or an HTTP(S) Git URL. The MCP protocol does
not expose content selection, hybrid weights, language selectors, path
selectors, reranking control, cache eviction, or an index-status operation.
Both tools return a JSON string rather than structured MCP content.

Code Intelligence consequence:

- Keep the official `search` and `find_related` operations as the retrieval
  boundary.
- Do not present lower-level Python parameters as though they were MCP
  capabilities.
- Remote repositories cannot be enriched by the local Volar workspace and are
  therefore outside the combined intelligence-tool contract.

Status: observed

## Process-local index lifecycle

```python
# Source: Semble 0.5.2, src/semble/mcp.py — serve, _IndexCache.get
cache = _IndexCache(content=content)
init_task = asyncio.create_task(_load_and_prewarm())

if cache_key not in self._tasks:
    model_path = await self._await_model()
    if len(self._tasks) >= _CACHE_MAX_SIZE:
        evicted_key, _ = self._tasks.popitem(last=False)
    self._tasks[cache_key] = asyncio.create_task(
        self._build_and_track(source, ref, model_path, cache_key)
    )

return await asyncio.shield(self._tasks[cache_key])
```

The server prewarms one embedding model in the background. Each MCP process
keeps at most ten indexes in an LRU `OrderedDict`. Concurrent calls for the same
canonical repository in one process share one build task, and cancellation of
an individual request does not cancel that build.

Local indexes are not watched. After a successful build, Semble delays the next
disk-staleness check until three times that build duration has elapsed. A later
tool call validates the cached manifest and evicts the in-memory index when the
files no longer match.

Code Intelligence consequence:

- One long-lived Semble child per Code Intelligence process preserves model and
  index reuse.
- Different Code Intelligence processes do not share in-memory indexes, even
  though their persisted caches may share a location.
- Freshness is call-driven and may intentionally lag within Semble's build-time
  cooldown. No product claim should describe this as file watching.

Status: observed

Installed `0.5.2` and upstream commit
`906319556a46bca45d8809b4733e05dd51cd5ba2` have identical `mcp.py` contents.

## CLI-only configuration

```python
# Source: Semble 0.5.2, src/semble/cli.py — _mcp_main
_add_content_args(parser)
content = _resolve_content(args.content, args.include_text_files)
asyncio.run(serve(content))

# Source: Semble 0.5.2, src/semble/cli.py — _resolve_content
if include_text_files or "all" in content:
    return [ContentType.CODE, ContentType.DOCS, ContentType.CONFIG]
return [ContentType(c) for c in content]
```

Launching the MCP process accepts:

```sh
semble --content code
semble --content code docs
semble --content all
```

Content selection is fixed for the life of the process. The default is
`code`; `all` expands to `code`, `docs`, and `config`. The deprecated
`--include-text-files` flag has the same effect as `all`.

The standalone CLI additionally exposes:

```sh
semble search QUERY PATH --content code docs --top-k 5 --max-snippet-lines 10
semble find-related FILE LINE PATH --content code
semble clear index
semble clear savings
semble savings
```

`clear` deletes every recognized persisted index globally. It is an
administrative command, not a safe per-workspace operation for an MCP used by
parallel agents.

Code Intelligence consequence:

- Keep the worker on `code` unless a practical tool needs documentation or
  configuration retrieval. A mixed `all` index cannot be filtered back to one
  content type through Semble's public MCP calls.
- Do not expose global cache clearing as an agent tool.
- A distinct docs/config retrieval surface would require a separately
  configured Semble process or a new upstream MCP affordance.

Status: observed

## Environment configuration

```python
# Source: Semble 0.5.2, src/semble/utils.py — resolve_model_name
DEFAULT_MODEL_NAME = "minishlab/potion-code-16M-v2"

def resolve_model_name() -> str:
    return os.environ.get("SEMBLE_MODEL_NAME", DEFAULT_MODEL_NAME)
```

`SEMBLE_MODEL_NAME` replaces the embedding model. The model identity is part of
cache validation, so changing it invalidates persisted indexes.

The MCP SDK's `StdioClientTransport` intentionally does not inherit the entire
parent environment. Code Intelligence therefore forwards only defined
`SEMBLE_*` variables on top of `getDefaultEnvironment()`. This also carries
`SEMBLE_CACHE_LOCATION`, `SEMBLE_CLONE_TIMEOUT`, and future namespaced Semble
configuration without creating a second configuration surface or exposing
unrelated secrets to the child.

An isolated built-MCP run with `SEMBLE_CACHE_LOCATION` wrote its index beneath
that exact directory. Before the forwarding change, the same run silently used
Semble's platform cache instead.

Status: source-observed and runtime-proven on macOS
