import { JsonKit } from '@kit-p/json-kit';

import { send_slack_request } from './request';

export function init_data(conversation) {
  return {
    conversation_id: conversation,
    ts: Date.now(),
    list: [],
  };
}

export function validate_data(conversation, data) {
  return (
    data.conversation_id === conversation &&
    typeof data.ts === 'number' &&
    Number.isSafeInteger(data.ts) &&
    data.ts > 0 &&
    data.ts <= Date.now() &&
    Array.isArray(data.list) &&
    data.list.every(
      (i) => typeof i.id === 'string' && typeof i.name === 'string'
    )
  );
}

export async function retrieve_bookmark(conversation) {
  const response = await send_slack_request('POST', '/bookmarks.list', {
    channel_id: conversation,
  });
  if (response.ok !== true || response.data.ok !== true) {
    console.error('Failed retrieving conversation bookmarks');
    console.log(JsonKit.stringify(response.data));
    return null;
  }

  const bookmarks = response.data.bookmarks;
  if (!Array.isArray(bookmarks)) {
    console.error('Failed parsing conversation bookmarks');
    console.log(JsonKit.stringify(response.data));
    return null;
  }

  const bookmark = bookmarks.find(
    (b) =>
      b.title === APP_NAME &&
      b.type === 'link' &&
      b.link != null &&
      b.link.startsWith(`${APP_ENDPOINT}/?conversation=${conversation}&data=`)
  );
  if (bookmark == null) {
    return null;
  }

  bookmark.link = new URL(bookmark.link);
  return bookmark;
}
