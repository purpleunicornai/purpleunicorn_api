import { Candidate } from '../roles/search/extract-candidate';

export interface GoogleSearchItem {
  title: string;
  link: string;
  snippet?: string;
  // The fetched page's own visible text, when PageFetchService was able to
  // retrieve it. Kept for GitHub results that still go through the generic
  // Gemini extractor.
  page_content?: string;
  // Which Vertex page this result came from (1-based). GitHub results omit it.
  page?: number;
  // Present when a search ran location and remote queries in parallel.
  matchedBy?: 'location' | 'remote';
  // LinkedIn profiles extracted from a Vertex result before scoring.
  extracted?: Candidate;
  [key: string]: unknown;
}
