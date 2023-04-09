import { JsonKit } from '@kit-p/json-kit';

import { get_help_block, get_help_text } from './help';

import { send_slack_request } from '../util/request';
import { init_data } from '../util/store';

export async function initialize_conversation(conversation, slient) {
  const initial_data = init_data(conversation);
  const data_str = JsonKit.stringify(initial_data, {
    extended: false,
    minify: false,
    compress: true,
  });
  let response = await send_slack_request('POST', '/bookmarks.add', {
    channel_id: conversation,
    type: 'link',
    title: APP_NAME,
    link: `${APP_ENDPOINT}/?conversation=${conversation}&data=${data_str}`,
  });
  if (response.ok !== true || response.data.ok !== true) {
    console.error('Failed adding bookmark to conversation');
    console.log(JsonKit.stringify(response.data));
    return;
  }

  if (slient === true) {
    return;
  }

  const welcome_text =
    "Welcome to the *Restaurant Picker*!\n\nLooks like you haven't added any restaurant, maybe let's do that first? :wink:\n\nYou can then manually initiate the pick or configure a scheduled workflow to automatically run the pick.";
  const fallback_text = `${welcome_text}\n\n${get_help_text()}`;
  response = await send_slack_request('POST', '/chat.postMessage', {
    channel: conversation,
    text: fallback_text,
    blocks: [
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: welcome_text,
        },
      },
      get_help_block(),
    ],
  });
  if (response.ok !== true || response.data.ok !== true) {
    console.error('Failed sending setup message to conversation');
    console.log(JsonKit.stringify(response.data));
  }
}
