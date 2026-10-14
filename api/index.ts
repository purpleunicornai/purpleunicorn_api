// Vercel's CLI only recognizes `functions` config keys (maxDuration,
// includeFiles, etc. in vercel.json) for files under api/ — the app's real
// entry point stays at src/main.ts, unchanged, with its own bootstrap()/
// app.listen() that Vercel's Node.js builder auto-wraps as a function. This
// file exists purely to give that same build a path Vercel's CLI will
// actually validate a `functions` key against.
import '../src/main';
