import { ClerkService } from '../common/clerk/clerk.service';

// Never throws — recording who ran a search is a nice-to-have, not
// something that should block the search itself if Clerk's API is slow
// or unreachable. Falls back from full name to username to the raw id.
export async function resolveUserName(
  clerkService: ClerkService,
  userId: string,
): Promise<string> {
  try {
    const user = await clerkService.getUser(userId);
    const fullName = [user.firstName, user.lastName]
      .filter(Boolean)
      .join(' ')
      .trim();
    return fullName || user.username || userId;
  } catch {
    return userId;
  }
}
