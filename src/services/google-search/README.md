# Web search backends

`GoogleSearchService` builds the LinkedIn/GitHub x-ray queries, pages through
results, de-dupes them and runs the relaxed retry. It asks a `SearchProvider`
(`search-providers.ts`) for one page of 10 results at a time. `SEARCH_PROVIDER`
picks the backend:

| `SEARCH_PROVIDER`  | Backend                             | Key env var                                        | Notes                                 |
| ------------------ | ----------------------------------- | -------------------------------------------------- | ------------------------------------- |
| `google` (default) | Google Custom Search JSON API       | `GOOGLE_SEARCH_API_KEY`, `GOOGLE_SEARCH_ENGINE_ID` | Shuts down 1 Jan 2027.                |
| `serper`           | serper.dev, live google.com results | `SERPER_API_KEY`                                   | Recommended replacement.              |
| `serpapi`          | SerpApi, live google.com results    | `SERPAPI_KEY`                                      | Fallback, as in `../serpapi/serp.ts`. |

Only the selected backend's key is required at startup. The queries are the
same on every backend. `serper` and `serpapi` also send the role's country as
`gl`, which ranks local results higher but filters nothing out.

The SERP backends don't return CSE's `pagemap`. When a result has an image it is
mapped to `pagemap.cse_thumbnail`, but there is no `og:description`.

## Smoke test

1. Set `SEARCH_PROVIDER=serper` and `SERPER_API_KEY=...` in `.env`.
2. Restart the API. It fails at startup if the selected key is missing.
3. Run a search on a role with location South Africa (ESSENTIAL) and
   education CA(SA) (ESSENTIAL).
4. The log shows the same `QUERY` lines as before. Check that results come back
   and that the candidates are South African.
5. To switch back, set `SEARCH_PROVIDER=google`.
