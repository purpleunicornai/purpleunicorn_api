# Web search backends

`GoogleSearchService` builds the LinkedIn/GitHub x-ray queries, pages through
results, de-dupes them and runs the relaxed retry. It asks a `SearchProvider`
(`search-providers.ts`) for one page of 10 results at a time. `SEARCH_PROVIDER`
picks the backend:

| `SEARCH_PROVIDER`  | Backend                             | Key env var                                        | Notes                                                 |
| ------------------ | ----------------------------------- | -------------------------------------------------- | ----------------------------------------------------- |
| `google` (default) | Google Custom Search JSON API       | `GOOGLE_SEARCH_API_KEY`, `GOOGLE_SEARCH_ENGINE_ID` | Shuts down 1 Jan 2027.                                |
| `serper`           | serper.dev, live google.com results | `SERPER_API_KEY`                                   | Recommended replacement.                              |
| `serpapi`          | SerpApi, live google.com results    | `SERPAPI_KEY`                                      | Fallback, as in `../serpapi/serp.ts`.                 |
| `vertex`           | Vertex AI Search (Discovery Engine) | `VERTEX_PROJECT_ID`, `VERTEX_ENGINE_ID`            | Searches only the sites in its data store. See below. |

Only the selected backend's key is required at startup. The queries are the
same on every backend. `serper` and `serpapi` also send the role's country as
`gl`, which ranks local results higher but filters nothing out.

The SERP backends don't return CSE's `pagemap`. When a result has an image it is
mapped to `pagemap.cse_thumbnail`, but there is no `og:description`.

## Saved AI term expansions

When a role's filters are saved, `RolesService.createFilter` asks Gemini once
to elaborate each job title and skill into an OR group (for example `founder`
becomes `founder`, `co-founder`, `entrepreneur`, `startup`, `side hustle`). The
groups are stored on `role_filters.metadata.criterionExpansions`
(`src/roles/search/criterion-expansions.ts`). Saving again reuses the stored
groups and only asks Gemini about new titles or skills. Search runs read the
stored groups and make no AI call for them. If Gemini fails, the filter set is
still saved and the new terms stay literal. A title or skill Gemini gave no
alternate terms for is not stored, so the next save asks again. Filter sets
saved before this feature have no stored groups until they are saved again.

In the query, an expanded title fills the title slot, each expanded essential
skill is one OR group in the AND chain, and optional skills become one OR
group. The site filter already uses 25 of Google's ~32 words. The words left
after the site filter and every literal clause (title, location, education,
literal skills, companies) are shared between the expanded groups, and each
group is split into extra queries within its share (seed in the first). Each
extra query swaps one later chunk in for its group's first chunk, so every
term is searched, but with two or more expanded groups not every combination
across groups is. A query can still pass 32 words when the literal clauses
already do, or when one term is longer than its share. A role with no stored
expansions builds the same queries as before.
Scoring still uses the literal criteria.

## Smoke test

1. Set `SEARCH_PROVIDER=serper` and `SERPER_API_KEY=...` in `.env`.
2. Restart the API. It fails at startup if the selected key is missing.
3. Run a search on a role with location South Africa (ESSENTIAL) and
   education CA(SA) (ESSENTIAL).
4. The log shows the same `QUERY` lines as before. Check that results come back
   and that the candidates are South African.
5. To switch back, set `SEARCH_PROVIDER=google`.

## Vertex AI Search (`SEARCH_PROVIDER=vertex`)

Google suggests Vertex AI Search (now part of "AI Applications", API name
Discovery Engine) as the Custom Search replacement. The backend calls:

```
POST https://discoveryengine.googleapis.com/v1/projects/{VERTEX_PROJECT_ID}/locations/{VERTEX_LOCATION}/collections/default_collection/engines/{VERTEX_ENGINE_ID}/servingConfigs/{VERTEX_SERVING_CONFIG_ID}:search
{ "query": "<same x-ray query>", "pageSize": 10, "offset": N, "contentSearchSpec": { "snippetSpec": { "returnSnippet": true } } }
```

and maps `results[].document.derivedStructData` (`title` or `htmlTitle`,
`link`, the first `snippets[].snippet` with tags removed, `pagemap`) to the CSE
item shape. Paging stops when the response has no `nextPageToken`. Unlike `gl` on Serper/SerpApi, the role's country isn't sent: the v1 API has no such field and rejects `regionCode` with a 400. Results
still go through the shared x-ray link filter (`isXraySiteLink`).

| Env var                    | Required | Default          | Notes                                                       |
| -------------------------- | -------- | ---------------- | ----------------------------------------------------------- |
| `VERTEX_PROJECT_ID`        | yes      |                  | Google Cloud project ID                                     |
| `VERTEX_ENGINE_ID`         | yes      |                  | The app ID from AI Applications > Apps                      |
| `VERTEX_LOCATION`          | no       | `global`         | `us` / `eu` use `{location}-discoveryengine.googleapis.com` |
| `VERTEX_SERVING_CONFIG_ID` | no       | `default_search` |                                                             |
| `VERTEX_SERVICE_ACCOUNT`   | yes\*    |                  | Base64 service-account JSON. \*Not needed with an API key.  |
| `VERTEX_API_KEY`           | no       |                  | Use `:searchLite?key=`. Public website data stores only.    |

### Google Cloud setup

1. Enable the Discovery Engine API (`discoveryengine.googleapis.com`).
2. In AI Applications, create a **Website** data store. Add the x-ray sites from
   `src/common/constants/google.ts` (`linkedin.com/in/*`, `indeed.com/r/*`, ...)
   as the sites to include.
3. Create a **Search** app on that data store. Its ID is `VERTEX_ENGINE_ID`.
4. Auth, either:
   - **Service account (default, as yuv-api):** create a service account with
     `roles/discoveryengine.viewer` and a JSON key. Put its base64 in
     `VERTEX_SERVICE_ACCOUNT` (`base64 -i key.json | tr -d '\n'`). It is
     decoded like yuv-api's `FIREBASE_SERVICE_ACCOUNT`
     (`JSON.parse(Buffer.from(value, 'base64').toString('ascii'))`), through
     `decodeBase64Json` in `src/common/utils/base64.ts` (`encodeBase64Json`
     there produces the same value from a parsed key), and passed to
     `google-auth-library`, which signs a token for each `:search` call.
     `GOOGLE_APPLICATION_CREDENTIALS` / ADC is not used.
   - **API key:** set `VERTEX_API_KEY` to a key restricted to the Discovery
     Engine API. Requests then go to `:searchLite`, which only works with
     public website data stores.

   Startup fails if `SEARCH_PROVIDER=vertex` and neither is set, or if the
   service-account value doesn't decode to a key with `client_email` and
   `private_key`.

### Caveats

- **Not full-web.** A website data store searches only the sites you add, not
  the whole web. Google's Custom Search migration guide points to Vertex AI
  Search for up to 50 domains. Full-web search is a separate enterprise
  product that you get through Google sales. Results are limited to profiles
  Google has indexed on the listed sites.
- The x-ray query is sent as-is. The data store already scopes which sites are
  searched, so the `site:` clause is redundant here. Check result quality
  before deciding to strip it for this backend.
- Basic website search returns only links, titles and snippets. Pages must be
  indexed first. With Advanced website indexing, Google requires you to prove
  you own the domain, which we can't do for linkedin.com.
- Billing is per query on the Google Cloud project, not per Serper/SerpApi credit.
