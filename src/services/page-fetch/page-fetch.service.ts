import { Injectable, Logger } from '@nestjs/common';
import axios, { AxiosInstance } from 'axios';
import * as cheerio from 'cheerio';
import { promises as dns } from 'dns';

// Sites known to block or gate anonymous fetches (LinkedIn requires a login
// to view a profile) — attempting them would just waste a request, so they're
// skipped before any network call is made.
const BLOCKED_HOSTNAMES = ['linkedin.com'];

const MAX_TEXT_LENGTH = 5000;

const ALLOWED_PROTOCOLS = ['http:', 'https:'];

@Injectable()
export class PageFetchService {
  private readonly logger = new Logger(PageFetchService.name);
  public client: AxiosInstance;

  constructor() {
    // maxRedirects: 0 — a result URL could otherwise redirect to an internal
    // address after DNS/protocol validation has already passed. A redirect
    // response fails axios's default validateStatus and lands in the catch
    // block below like any other fetch failure, rather than being followed.
    this.client = axios.create({ timeout: 10_000, maxRedirects: 0 });
  }

  // Fetches a URL and extracts its visible body text for use as enrichment
  // context. Never throws — a blocked host, disallowed protocol, private/
  // internal address, network failure, timeout, or non-HTML response all
  // resolve to undefined so one bad link can't fail the whole deep search.
  async fetchPageText(url: string): Promise<string | undefined> {
    const parsed = this.parseAllowedUrl(url);
    if (!parsed) return undefined;
    if (this.isBlockedHostname(parsed.hostname)) return undefined;

    try {
      if (!(await this.isPubliclyRoutable(parsed.hostname))) {
        this.logger.debug(`Refusing to fetch non-public address for ${url}`);
        return undefined;
      }

      const response = await this.client.get(url);
      const contentType = String(
        response.headers?.['content-type'] ?? '',
      ).toLowerCase();
      if (!contentType.includes('text/html')) return undefined;

      return this.extractText(String(response.data));
    } catch (error) {
      this.logger.debug(
        `Failed to fetch page text for ${url}: ${error instanceof Error ? error.message : String(error)}`,
      );
      return undefined;
    }
  }

  private parseAllowedUrl(url: string): URL | undefined {
    try {
      const parsed = new URL(url);
      return ALLOWED_PROTOCOLS.includes(parsed.protocol) ? parsed : undefined;
    } catch {
      return undefined;
    }
  }

  private isBlockedHostname(hostname: string): boolean {
    const host = hostname.toLowerCase();
    return BLOCKED_HOSTNAMES.some(
      (blocked) => host === blocked || host.endsWith(`.${blocked}`),
    );
  }

  // Resolves the hostname and refuses to proceed if any resolved address is
  // loopback/private/link-local/reserved — without this, a search result
  // URL pointing at an internal host or the cloud metadata endpoint
  // (169.254.169.254) would be fetched server-side (SSRF). A hostname that
  // fails to resolve is treated as not publicly routable.
  private async isPubliclyRoutable(hostname: string): Promise<boolean> {
    let addresses: { address: string; family: number }[];
    try {
      addresses = await dns.lookup(hostname, { all: true });
    } catch {
      return false;
    }
    return (
      addresses.length > 0 &&
      addresses.every(({ address }) => !this.isPrivateAddress(address))
    );
  }

  private isPrivateAddress(address: string): boolean {
    return address.includes(':')
      ? this.isPrivateIpv6(address)
      : this.isPrivateIpv4(address);
  }

  private isPrivateIpv4(address: string): boolean {
    const parts = address.split('.').map(Number);
    if (parts.length !== 4 || parts.some((part) => Number.isNaN(part))) {
      return true;
    }
    const [a, b] = parts;
    if (a === 0) return true; // 0.0.0.0/8
    if (a === 10) return true; // 10.0.0.0/8 private
    if (a === 100 && b >= 64 && b <= 127) return true; // 100.64.0.0/10 CGNAT
    if (a === 127) return true; // 127.0.0.0/8 loopback
    if (a === 169 && b === 254) return true; // 169.254.0.0/16 link-local / cloud metadata
    if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12 private
    if (a === 192 && b === 168) return true; // 192.168.0.0/16 private
    if (a >= 224) return true; // multicast + reserved
    return false;
  }

  private isPrivateIpv6(address: string): boolean {
    const normalized = address.toLowerCase();
    if (normalized === '::1' || normalized === '::') return true; // loopback / unspecified
    if (/^fe[89ab][0-9a-f]:/.test(normalized)) return true; // fe80::/10 link-local
    if (/^f[cd][0-9a-f]{2}:/.test(normalized)) return true; // fc00::/7 unique-local

    // IPv4-mapped IPv6 (::ffff:a.b.c.d) — validate the embedded address too.
    const mapped = normalized.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    return mapped ? this.isPrivateIpv4(mapped[1]) : false;
  }

  private extractText(html: string): string {
    // Adjacent tags with no text node between them (e.g. "</h1><p>") would
    // otherwise have their text run together with no separating space.
    const spaced = html.replace(/>(?=<)/g, '> ');
    const $ = cheerio.load(spaced);
    $('script, style').remove();
    const text = $('body').text().replace(/\s+/g, ' ').trim();
    return text.slice(0, MAX_TEXT_LENGTH);
  }
}
