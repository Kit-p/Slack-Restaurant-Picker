import { v4 as uuid } from 'uuid';
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

export function repair_data(conversation, data) {
  // should always be in sync with `validate_data()`
  const repaired_data = {
    conversation_id: conversation,
    ts: Date.now(),
    list: [],
  };

  if (data == null || typeof data !== 'object' || Array.isArray(data)) {
    return repaired_data;
  }

  if (typeof data.ts === 'number' && data.ts > 0 && data.ts <= Date.now()) {
    repaired_data.ts = data.ts;
  }

  if (Array.isArray(data.list)) {
    for (let i = 0; i < data.list.length; i++) {
      let item = data.list[i];

      if (item == null || typeof item !== 'object' || Array.isArray(item)) {
        item = {};
        data.list[i] = item;
      }

      if (typeof item.id !== 'string') {
        item.id = uuid();
      }

      if (typeof item.name !== 'string') {
        item.name = 'UNKNOWN';
      }

      repaired_data.list.push(item);
    }
  }

  return repaired_data;
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

export async function update_bookmark(conversation, bookmark_id, data) {
  data.ts = Date.now();
  const data_str = JsonKit.stringify(data, {
    extended: false,
    minify: false,
    compress: true,
  });
  const response = await send_slack_request('POST', '/bookmarks.edit', {
    channel_id: conversation,
    bookmark_id,
    link: `${APP_ENDPOINT}/?conversation=${conversation}&data=${data_str}`,
  });
  if (response.ok !== true || response.data.ok !== true) {
    console.error('Failed editing bookmark in conversation after edit');
    console.log(JsonKit.stringify(response.data));
    return false;
  }
  return true;
}
