import { status } from 'itty-router-extras';
import { JsonKit } from '@kit-p/json-kit';

import { initialize_conversation } from './init';
import { list_action } from './list';

import {
  retrieve_bookmark,
  update_bookmark,
  validate_data,
} from '../util/store';

export async function delete_action(conversation, restaurant_id, view_id) {
  let bookmark = await retrieve_bookmark(conversation);
  if (bookmark == null) {
    await initialize_conversation(conversation, true);
    bookmark = await retrieve_bookmark(conversation);
    if (bookmark == null) {
      console.error('Failed getting bookmark');
      console.log(JsonKit.stringify(payload));
      return status(500);
    }
  }

  const data = JsonKit.parse(bookmark.link.searchParams.get('data'));
  if (!validate_data(conversation, data)) {
    // TODO: call pick_restaurant_repair
    console.error('Invalid bookmark data');
    return status(500);
  }

  const restaurant_idx = data.list.findIndex((r) => r.id === restaurant_id);
  if (restaurant_idx < 0) {
    return status(200);
  }

  data.list.splice(restaurant_idx, 1);

  if (!(await update_bookmark(conversation, data))) {
    return status(500);
  }
  return await list_action(conversation, view_id, true);
}
