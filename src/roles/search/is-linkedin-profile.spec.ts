import { isLinkedInProfileUrl } from './is-linkedin-profile';

describe('isLinkedInProfileUrl', () => {
  it.each([
    'https://www.linkedin.com/in/jane-doe',
    'https://za.linkedin.com/in/jane-doe-12345/',
    'https://linkedin.com/in/jane',
  ])('accepts profile %s', (link) => {
    expect(isLinkedInProfileUrl(link)).toBe(true);
  });

  it.each([
    'https://www.linkedin.com/jobs/view/react-native-developer-123',
    'https://za.linkedin.com/jobs/react-native-jobs',
    'https://www.linkedin.com/company/acme',
    'https://www.linkedin.com/posts/jane-doe_hiring-123',
    'https://www.linkedin.com/in/',
    'https://notlinkedin.com/in/jane',
    'not a url',
    undefined,
  ])('rejects %s', (link) => {
    expect(isLinkedInProfileUrl(link)).toBe(false);
  });
});
