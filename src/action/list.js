import { status } from 'itty-router-extras';
import { JsonKit } from '@kit-p/json-kit';

import { initialize_conversation } from './init';

import { send_slack_request } from '../util/request';
import { retrieve_bookmark, validate_data } from '../util/store';

export async function list_action(
  conversation,
  trigger_or_view_id,
  is_update = false
) {
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

  const raw_data = bookmark.link.searchParams.get('data');
  const data = JsonKit.parse(raw_data);
  if (!validate_data(conversation, data)) {
    // TODO: call pick_restaurant_repair
    console.error('Invalid bookmark data');
    return status(500);
  }

  const response = await send_slack_request(
    'POST',
    is_update ? '/views.update' : '/views.open',
    {
      ...(is_update
        ? { view_id: trigger_or_view_id }
        : { trigger_id: trigger_or_view_id }),
      view: {
        type: 'modal',
        title: {
          type: 'plain_text',
          text: 'Restaurant List',
          emoji: true,
        },
        close: {
          type: 'plain_text',
          text: 'Close',
          emoji: true,
        },
        submit: {
          type: 'plain_text',
          text: 'Done',
          emoji: true,
        },
        private_metadata: JsonKit.stringify({
          conversation,
          data: raw_data,
        }),
        callback_id: 'pick_restaurant-list',
        blocks: [
          ...data.list
            .sort((a, b) => {
              if (a.win_count !== b.win_count) {
                return b.win_count - a.win_count;
              }
              if (a.shown_count !== b.shown_count) {
                return a.shown_count - b.shown_count;
              }
              return b.weight - a.weight;
            })
            .flatMap((restaurant) => {
              return [
                {
                  block_id: restaurant.id,
                  type: 'section',
                  text: {
                    type: 'mrkdwn',
                    text: `:knife_fork_plate: *${restaurant.name}*`,
                  },
                  accessory: {
                    type: 'overflow',
                    confirm: {
                      title: {
                        type: 'plain_text',
                        text: 'Are you sure?',
                        emoji: true,
                      },
                      text: {
                        type: 'plain_text',
                        text: `You are going to edit/remove *${restaurant.name}*!\nPlease confirm the action.`,
                        emoji: true,
                      },
                      confirm: {
                        type: 'plain_text',
                        text: 'Continue',
                        emoji: true,
                      },
                      deny: {
                        type: 'plain_text',
                        text: 'Cancel',
                        emoji: true,
                      },
                      style: 'danger',
                    },
                    options: [
                      {
                        text: {
                          type: 'plain_text',
                          text: ':pencil2:    Edit',
                          emoji: true,
                        },
                        value: 'edit',
                      },
                      {
                        text: {
                          type: 'plain_text',
                          text: ':x:    Remove',
                          emoji: true,
                        },
                        value: 'remove',
                      },
                    ],
                    action_id: 'pick_restaurant_list-action',
                  },
                },
                {
                  block_id: `context_${restaurant.id}`,
                  type: 'context',
                  elements: [
                    {
                      type: 'mrkdwn',
                      text: `:anchor: Weight: *${restaurant.weight}*`,
                    },
                    {
                      type: 'mrkdwn',
                      text: `:bulb: Shown Count: *${restaurant.shown_count}*`,
                    },
                    {
                      type: 'mrkdwn',
                      text: `:100: Win Rate: *${
                        restaurant.shown_count > 0
                          ? (
                              (restaurant.win_count / restaurant.shown_count) *
                              100
                            ).toFixed(0)
                          : 0
                      }%*`,
                    },
                  ],
                },
              ];
            }),
        ],
      },
    }
  );
  if (response.ok !== true || response.data.ok !== true) {
    console.error('Failed opening list modal');
    console.log(JsonKit.stringify(response.data));
    return status(500);
  }
  return status(200);
}
