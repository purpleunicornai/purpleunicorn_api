# Vertex candidate search

Role discovery searches LinkedIn profiles through Vertex AI Search
(`@google-cloud/discoveryengine`) and no longer uses Google Custom Search,
Serper, or SerpAPI.

The query always starts with an unparenthesized `site:linkedin.com/in`,
followed by mandatory filter rows as quoted OR groups. Saved AI expansions
on `role_filters.metadata.criterionExpansions` widen title and skill groups
in place. When remote work is allowed and a region is named, a location-only
query and a remote-only query run side by side, local hits first.

Results are filtered to `linkedin.com/in/<slug>` URLs, gated when a snippet
names a clearly different country, and paginated with a composite `s1.` token
that also remembers people already returned. One role-search run walks pages
until 100 unique profiles or the streams run out.

Required env vars: `VERTEX_PROJECT_ID`, `VERTEX_ENGINE_ID`, and either
`VERTEX_SERVICE_ACCOUNT` (base64 service-account JSON) or `VERTEX_API_KEY`.
Optional: `VERTEX_LOCATION` (default `global`), `VERTEX_SERVING_CONFIG_ID`
(default `default_search`).
