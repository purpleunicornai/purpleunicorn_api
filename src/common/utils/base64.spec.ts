import {
  decodeBase64,
  decodeBase64Json,
  encodeBase64,
  encodeBase64Json,
} from './base64';

describe('base64 helpers', () => {
  const serviceAccount = {
    type: 'service_account',
    project_id: 'my-project',
    client_email: 'search@my-project.iam.gserviceaccount.com',
    private_key:
      '-----BEGIN PRIVATE KEY-----\nabc\n-----END PRIVATE KEY-----\n',
  };

  it('round-trips a string', () => {
    expect(encodeBase64('hello world')).toBe('aGVsbG8gd29ybGQ=');
    expect(decodeBase64('aGVsbG8gd29ybGQ=')).toBe('hello world');
  });

  it('round-trips a service-account JSON key', () => {
    const encoded = encodeBase64Json(serviceAccount);
    expect(encoded).toMatch(/^[A-Za-z0-9+/]+=*$/);
    expect(decodeBase64Json(encoded)).toEqual(serviceAccount);
  });

  it('decodes the same as `base64 -i key.json`, including line-wrapped output', () => {
    const encoded = Buffer.from(JSON.stringify(serviceAccount)).toString(
      'base64',
    );
    const wrapped = encoded.replace(/(.{76})/g, '$1\n') + '\n';
    expect(decodeBase64Json(wrapped)).toEqual(serviceAccount);
  });

  it('rejects input that is not base64', () => {
    expect(() => decodeBase64('')).toThrow('not valid base64');
    expect(() => decodeBase64('not base64!')).toThrow('not valid base64');
    expect(() => decodeBase64('abcde')).toThrow('not valid base64');
    expect(() => decodeBase64Json('{"raw": "json"}')).toThrow(
      'not valid base64',
    );
  });

  it('rejects base64 that is not JSON', () => {
    expect(() => decodeBase64Json(encodeBase64('plain text'))).toThrow(
      'does not decode to JSON',
    );
  });
});
