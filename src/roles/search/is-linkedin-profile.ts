// Vertex's Site search doesn't reliably honour a `site:` operator, so job
// postings (linkedin.com/jobs/...) still come back. Only public profile
// pages — linkedin.com/in/<slug>, any subdomain like za.linkedin.com — are
// candidates.
export function isLinkedInProfileUrl(link: string | undefined): link is string {
  if (!link) return false;
  try {
    const url = new URL(link);
    const host = url.hostname.toLowerCase();
    const onLinkedIn =
      host === 'linkedin.com' || host.endsWith('.linkedin.com');
    return onLinkedIn && /^\/in\/[^/]+/i.test(url.pathname);
  } catch {
    return false;
  }
}
