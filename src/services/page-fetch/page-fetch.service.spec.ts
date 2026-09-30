import { promises as dns } from 'dns';
import { PageFetchService } from './page-fetch.service';

describe('PageFetchService', () => {
  let service: PageFetchService;

  beforeEach(() => {
    service = new PageFetchService();
    // dns.promises is a shared singleton across tests in this file (unlike
    // service.client, which is a fresh instance per test) — mockReset clears
    // prior call history so assertions on `lookup` don't see other tests'
    // calls. Defaults to a public address so only the SSRF-focused tests
    // below need to override this.
    jest
      .spyOn(dns, 'lookup')
      .mockReset()
      .mockResolvedValue([{ address: '93.184.216.34', family: 4 }] as any);
  });

  it('fetches the page and extracts its visible text', async () => {
    jest.spyOn(service.client, 'get').mockResolvedValue({
      headers: { 'content-type': 'text/html; charset=utf-8' },
      data: '<html><head><style>.a{}</style></head><body><script>evil()</script><h1>Jane Doe</h1><p>Senior Engineer at Acme</p></body></html>',
    });

    const result = await service.fetchPageText('https://example.com/jane');

    expect(result).toBe('Jane Doe Senior Engineer at Acme');
  });

  it('skips linkedin.com URLs without making a request', async () => {
    const get = jest.spyOn(service.client, 'get');

    const result = await service.fetchPageText(
      'https://www.linkedin.com/in/janedoe',
    );

    expect(get).not.toHaveBeenCalled();
    expect(result).toBeUndefined();
  });

  it('returns undefined when the response is not HTML', async () => {
    jest.spyOn(service.client, 'get').mockResolvedValue({
      headers: { 'content-type': 'application/pdf' },
      data: '%PDF-1.4',
    });

    const result = await service.fetchPageText('https://example.com/resume');

    expect(result).toBeUndefined();
  });

  it('returns undefined instead of throwing when the request fails', async () => {
    jest
      .spyOn(service.client, 'get')
      .mockRejectedValue(new Error('timeout of 10000ms exceeded'));

    const result = await service.fetchPageText('https://example.com/jane');

    expect(result).toBeUndefined();
  });

  it('returns undefined and does not fetch when the URL uses a non-http(s) protocol', async () => {
    const get = jest.spyOn(service.client, 'get');
    const lookup = jest.spyOn(dns, 'lookup');

    const result = await service.fetchPageText('file:///etc/passwd');

    expect(get).not.toHaveBeenCalled();
    expect(lookup).not.toHaveBeenCalled();
    expect(result).toBeUndefined();
  });

  it('returns undefined and does not fetch when the hostname resolves to a loopback address', async () => {
    jest
      .spyOn(dns, 'lookup')
      .mockResolvedValue([{ address: '127.0.0.1', family: 4 }] as any);
    const get = jest.spyOn(service.client, 'get');

    const result = await service.fetchPageText('https://internal.example/x');

    expect(get).not.toHaveBeenCalled();
    expect(result).toBeUndefined();
  });

  it('returns undefined and does not fetch when the hostname resolves to a link-local / cloud-metadata address', async () => {
    jest
      .spyOn(dns, 'lookup')
      .mockResolvedValue([{ address: '169.254.169.254', family: 4 }] as any);
    const get = jest.spyOn(service.client, 'get');

    const result = await service.fetchPageText('https://internal.example/x');

    expect(get).not.toHaveBeenCalled();
    expect(result).toBeUndefined();
  });

  it('returns undefined and does not fetch when the hostname resolves to a private RFC1918 address', async () => {
    jest
      .spyOn(dns, 'lookup')
      .mockResolvedValue([{ address: '10.0.5.2', family: 4 }] as any);
    const get = jest.spyOn(service.client, 'get');

    const result = await service.fetchPageText('https://internal.example/x');

    expect(get).not.toHaveBeenCalled();
    expect(result).toBeUndefined();
  });

  it('returns undefined and does not fetch when the hostname resolves to an IPv6 loopback or unique-local address', async () => {
    jest
      .spyOn(dns, 'lookup')
      .mockResolvedValue([{ address: '::1', family: 6 }] as any);
    const get = jest.spyOn(service.client, 'get');

    const result = await service.fetchPageText('https://internal.example/x');

    expect(get).not.toHaveBeenCalled();
    expect(result).toBeUndefined();
  });

  it('returns undefined when the hostname fails to resolve', async () => {
    jest.spyOn(dns, 'lookup').mockRejectedValue(new Error('ENOTFOUND'));
    const get = jest.spyOn(service.client, 'get');

    const result = await service.fetchPageText('https://nowhere.invalid/x');

    expect(get).not.toHaveBeenCalled();
    expect(result).toBeUndefined();
  });

  it('truncates extracted text to the max length', async () => {
    jest.spyOn(service.client, 'get').mockResolvedValue({
      headers: { 'content-type': 'text/html' },
      data: `<html><body><p>${'a'.repeat(10000)}</p></body></html>`,
    });

    const result = await service.fetchPageText('https://example.com/jane');

    expect(result).toHaveLength(5000);
  });
});
