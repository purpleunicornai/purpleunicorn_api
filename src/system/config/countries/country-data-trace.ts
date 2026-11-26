/**
 * @countrystatecity/countries loads JSON from dist/data via dynamic import/fs
 * paths (`./data/${countryDir}/states.json`, etc.) that Vercel's file tracer
 * cannot follow. Node File Trace emitGlobs treats `__dirname + '/dir/'` and
 * `require.resolve('pkg/data/' + name)` as "include this directory tree".
 * The __dirname path is four segments up from this file in both src/ and
 * dist/. Import this module from the countries service so it stays in the
 * entry graph. Do not remove, or country/city data will be missing from the
 * Vercel bundle (~4740 JSON files, ~46 MB).
 */
export const COUNTRY_DATA_DIR =
  __dirname +
  '/../../../../node_modules/@countrystatecity/countries/dist/data/';

function traceCountryDataForVercel(relativePath: string): void {
  require.resolve('@countrystatecity/countries/data/' + relativePath);
}

void COUNTRY_DATA_DIR;
void traceCountryDataForVercel;
