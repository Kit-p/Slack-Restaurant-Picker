import { json, status } from 'itty-router-extras';
import { v4 as uuid } from 'uuid';
import { JsonKit } from '@kit-p/json-kit';

import { initialize_conversation } from '../action/init';
import { list_action } from '../action/list';
import { get_pick_payload, retrieve_pick_message } from '../action/pick';
import { vote_action } from '../action/vote';

import { send_slack_request } from '../util/request';
import { retrieve_bookmark, validate_data } from '../util/store';

export async function interaction_handler(payload) {
  let callback_id = null;
  try {
    callback_id = payload.callback_id || payload.view.callback_id;
  } catch (ignored) {}

  switch (callback_id) {
    case 'pick_restaurant': {
      const conversations_select_block_id = 'conversations_select-block';
      const conversations_select_action_id = 'conversations_select-action';
      const number_input_block_id = 'number_input-block';
      const number_input_action_id = 'number_input-action';
      switch (payload.type) {
        case 'workflow_step_edit': {
          const has_selected_conversation =
            payload.workflow_step &&
            payload.workflow_step.inputs.selected_conversation;
          const has_number_of_choices =
            payload.workflow_step &&
            payload.workflow_step.inputs.number_of_choices;
          const response = await send_slack_request('POST', '/views.open', {
            trigger_id: payload.trigger_id,
            view: {
              type: 'workflow_step',
              callback_id: payload.callback_id,
              submit_disabled: false,
              blocks: [
                {
                  block_id: conversations_select_block_id,
                  type: 'input',
                  element: {
                    type: 'conversations_select',
                    filter: {
                      include: ['public', 'private'],
                      exclude_external_shared_channels: true,
                      exclude_bot_users: true,
                    },
                    placeholder: {
                      type: 'plain_text',
                      text: 'Select a channel',
                      emoji: true,
                    },
                    action_id: conversations_select_action_id,
                    focus_on_load: true,
                    ...(has_selected_conversation && {
                      initial_conversation:
                        payload.workflow_step.inputs.selected_conversation
                          .value,
                    }),
                  },
                  label: {
                    type: 'plain_text',
                    text: 'Message Destination',
                    emoji: true,
                  },
                },
                {
                  type: 'section',
                  text: {
                    type: 'mrkdwn',
                    text: '> :exclamation: For *private* channels, please first integrate this app.',
                  },
                },
                {
                  block_id: number_input_block_id,
                  type: 'input',
                  element: {
                    type: 'number_input',
                    is_decimal_allowed: false,
                    placeholder: {
                      type: 'plain_text',
                      text: 'Enter a number between 1-9',
                      emoji: true,
                    },
                    action_id: number_input_action_id,
                    min_value: '1',
                    max_value: '9',
                    focus_on_load: false,
                    initial_value: has_number_of_choices
                      ? payload.workflow_step.inputs.number_of_choices.value.toString()
                      : '1',
                  },
                  label: {
                    type: 'plain_text',
                    text: 'Number of Choices To Pick',
                    emoji: true,
                  },
                },
              ],
            },
          });
          if (response.ok !== true || response.data.ok !== true) {
            console.error('Failed opening config modal');
            console.log(JsonKit.stringify(response.data));
            return status(500);
          }
          return status(200);
        }
        case 'view_submission': {
          const selected_conversation =
            payload.view.state.values[conversations_select_block_id][
              conversations_select_action_id
            ].selected_conversation;
          if (typeof selected_conversation !== 'string') {
            return json(
              {
                response_action: 'errors',
                errors: {
                  [conversations_select_block_id]: 'Please select a channel!',
                },
              },
              { status: 200 }
            );
          }
          const number_of_choices = Number.parseInt(
            payload.view.state.values[number_input_block_id][
              number_input_action_id
            ].value,
            10
          );
          if (typeof number_of_choices !== 'number' || number_of_choices <= 0) {
            return json(
              {
                response_action: 'errors',
                errors: {
                  [number_input_block_id]: 'Please enter a positive integer!',
                },
              },
              { status: 200 }
            );
          }

          // update payload
          const response = await send_slack_request(
            'POST',
            '/workflows.updateStep',
            {
              workflow_step_edit_id:
                payload.workflow_step.workflow_step_edit_id,
              inputs: {
                selected_conversation: {
                  type: 'plain_text',
                  value: selected_conversation,
                },
                number_of_choices: {
                  type: 'number',
                  value: number_of_choices,
                },
              },
            }
          );
          if (response.ok !== true || response.data.ok !== true) {
            console.error('Failed updating workflow step');
            console.log(JsonKit.stringify(response.data));
            return status(500);
          }
          return status(200);
        }
        default: {
          console.error('Received unknown interaction type');
          console.log(JsonKit.stringify(payload));
          break;
        }
      }
      break;
    }
    case 'pick_restaurant-new': {
      switch (payload.type) {
        case 'view_submission': {
          const restaurant_name =
            payload.view.state.values['restaurant_name-block'][
              'restaurant_name-action'
            ].value;
          if (typeof restaurant_name !== 'string') {
            return json(
              {
                response_action: 'errors',
                errors: {
                  'restaurant_name-block': 'Name is invalid!',
                },
              },
              { status: 200 }
            );
          }
          const restaruant_weight = Number.parseInt(
            payload.view.state.values['restaurant_weight-block'][
              'restaurant_weight-action'
            ].value,
            10
          );
          if (typeof restaruant_weight !== 'number' || restaruant_weight < 0) {
            return json(
              {
                response_action: 'errors',
                errors: {
                  'restaurant_weight-block': 'Please enter a positive integer!',
                },
              },
              { status: 200 }
            );
          }

          const { conversation } = JsonKit.parse(payload.view.private_metadata);
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

          if (data.list.findIndex((r) => r.name === restaurant_name) >= 0) {
            return json(
              {
                response_action: 'errors',
                errors: {
                  'restaurant_name-block': 'This restaurant has been added!',
                },
              },
              { status: 200 }
            );
          }

          data.list.push({
            id: uuid(),
            name: restaurant_name,
            weight: restaruant_weight,
            shown_count: 0,
            win_count: 0,
          });

          // update bookmark
          data.ts = Date.now();
          const data_str = JsonKit.stringify(data, {
            extended: false,
            minify: false,
            compress: true,
          });
          const response = await send_slack_request('POST', '/bookmarks.edit', {
            channel_id: conversation,
            bookmark_id: bookmark.id,
            link: `${APP_ENDPOINT}/?conversation=${conversation}&data=${data_str}`,
          });
          if (response.ok !== true || response.data.ok !== true) {
            console.error('Failed editing bookmark in conversation after new');
            console.log(JsonKit.stringify(response.data));
            return status(500);
          }
          return status(200);
        }
        default: {
          console.error('Received unknown interaction type');
          console.log(JsonKit.stringify(payload));
          break;
        }
      }
    }
    case 'pick_restaurant-edit': {
      switch (payload.type) {
        case 'view_submission': {
          const restaurant_name =
            payload.view.state.values['restaurant_name-block'][
              'restaurant_name-action'
            ].value;
          if (typeof restaurant_name !== 'string') {
            return json(
              {
                response_action: 'errors',
                errors: {
                  'restaurant_name-block': 'Name is invalid!',
                },
              },
              { status: 200 }
            );
          }
          const restaruant_weight = Number.parseInt(
            payload.view.state.values['restaurant_weight-block'][
              'restaurant_weight-action'
            ].value,
            10
          );
          if (typeof restaruant_weight !== 'number' || restaruant_weight < 0) {
            return json(
              {
                response_action: 'errors',
                errors: {
                  'restaurant_weight-block': 'Please enter a positive integer!',
                },
              },
              { status: 200 }
            );
          }

          const { conversation, list_view, data_ts, restaurant_id } =
            JsonKit.parse(payload.view.private_metadata);
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

          if (data.ts > data_ts) {
            console.error('Dirty write detected');
            return json(
              {
                response_action: 'errors',
                errors: {
                  'restaurant_name-block':
                    'Data has been modified by another user!',
                },
              },
              { status: 200 }
            );
          }

          const restaurant_idx = data.list.findIndex(
            (r) => r.id === restaurant_id
          );
          if (restaurant_idx < 0) {
            return json(
              {
                response_action: 'errors',
                errors: {
                  'restaurant_name-block':
                    'This restaurant has been removed by another user!',
                },
              },
              { status: 200 }
            );
          }

          data.list[restaurant_idx].name = restaurant_name;
          data.list[restaurant_idx].weight = restaruant_weight;

          // update bookmark
          data.ts = Date.now();
          const data_str = JsonKit.stringify(data, {
            extended: false,
            minify: false,
            compress: true,
          });
          const response = await send_slack_request('POST', '/bookmarks.edit', {
            channel_id: conversation,
            bookmark_id: bookmark.id,
            link: `${APP_ENDPOINT}/?conversation=${conversation}&data=${data_str}`,
          });
          if (response.ok !== true || response.data.ok !== true) {
            console.error('Failed editing bookmark in conversation after edit');
            console.log(JsonKit.stringify(response.data));
            return status(500);
          }
          return await list_action(conversation, list_view, true);
        }
        default: {
          console.error('Received unknown interaction type');
          console.log(JsonKit.stringify(payload));
          break;
        }
      }
    }
    case 'pick_restaurant-pick_overwrite': {
      switch (payload.type) {
        case 'view_submission': {
          const { conversation, message_ts, user_id, restaurant_id } =
            JsonKit.parse(payload.view.private_metadata);
          return await vote_action(
            conversation,
            message_ts,
            user_id,
            restaurant_id
          );
        }
        default: {
          console.error('Received unknown interaction type');
          console.log(JsonKit.stringify(payload));
          break;
        }
      }
    }
    case 'pick_restaurant-pick_end': {
      switch (payload.type) {
        case 'view_submission': {
          const { conversation, message_ts, user_id } = JsonKit.parse(
            payload.view.private_metadata
          );

          const pick_message = await retrieve_pick_message(
            conversation,
            message_ts
          );
          if (pick_message == null) {
            console.error('Failed retrieving action source pick message');
            return status(500);
          }

          const pick_metadata = pick_message.metadata;
          pick_metadata.event_payload.is_ended = true;
          pick_metadata.event_payload.ts = Date.now();

          const message_payload = get_pick_payload(
            conversation,
            pick_metadata.event_payload.choices,
            pick_metadata.event_payload.number_of_choices,
            true,
            user_id
          );
          let response = await send_slack_request('POST', '/chat.update', {
            ts: message_ts,
            ...message_payload,
          });
          if (response.ok !== true || response.data.ok !== true) {
            console.error(
              'Failed updating pick message to end vote in conversation'
            );
            console.log(JsonKit.stringify(response.data));
            return status(500);
          }

          const bookmark = await retrieve_bookmark(conversation);
          if (bookmark != null) {
            const data = JsonKit.parse(bookmark.link.searchParams.get('data'));
            for (const restaurant of data.list) {
              if (
                message_payload.metadata.event_payload.winners.includes(
                  restaurant.id
                )
              ) {
                restaurant.win_count++;
              }
            }

            // update bookmark
            data.ts = Date.now();
            const data_str = JsonKit.stringify(data, {
              extended: false,
              minify: false,
              compress: true,
            });
            response = await send_slack_request('POST', '/bookmarks.edit', {
              channel_id: conversation,
              bookmark_id: bookmark.id,
              link: `${APP_ENDPOINT}/?conversation=${conversation}&data=${data_str}`,
            });
            if (response.ok !== true || response.data.ok !== true) {
              console.error(
                'Failed editing bookmark in conversation after pick end'
              );
              console.log(JsonKit.stringify(response.data));
            }
          }

          const voted_users = [
            ...new Set(
              pick_metadata.event_payload.choices.flatMap((c) =>
                c.votes.map((v) => v.user_id)
              )
            ),
          ];
          for (const user of voted_users) {
            response = await send_slack_request('POST', '/chat.postEphemeral', {
              channel: conversation,
              text: `<@${user}> Vote has ended! You may check the result.`,
              user: user,
            });
            if (response.ok !== true || response.data.ok !== true) {
              console.error(
                `Failed sending vote end empheral (user: ${user}) message to conversation`
              );
              console.log(JsonKit.stringify(response.data));
            }
          }

          return status(200);
        }
        default: {
          console.error('Received unknown interaction type');
          console.log(JsonKit.stringify(payload));
          break;
        }
      }
    }
    default: {
      switch (payload.type) {
        case 'block_actions': {
          const conversation_id =
            payload.channel != null ? payload.channel.id : null;
          const message_ts =
            payload.message != null ? payload.message.ts : null;
          const view_id = payload.view != null ? payload.view.id : null;
          const user_id = payload.user.id;
          const trigger_id = payload.trigger_id;

          if (!Array.isArray(payload.actions) || typeof user_id !== 'string') {
            return status(400);
          }

          for (const action of payload.actions) {
            switch (action.action_id) {
              case 'pick_restaurant_pick_vote-action': {
                if (
                  typeof conversation_id !== 'string' ||
                  typeof message_ts !== 'string'
                ) {
                  return status(400);
                }
                const restaurant_id = action.value;
                return await vote_action(
                  conversation_id,
                  message_ts,
                  user_id,
                  restaurant_id,
                  trigger_id
                );
              }
              case 'pick_restaurant_pick_add_choice-action': {
                if (
                  typeof conversation_id !== 'string' ||
                  typeof message_ts !== 'string'
                ) {
                  return status(400);
                }
                const pick_message = await retrieve_pick_message(
                  conversation_id,
                  message_ts
                );
                if (pick_message == null) {
                  console.error('Failed retrieving action source pick message');
                  return status(500);
                }

                const pick_metadata = pick_message.metadata;
                const last_choice =
                  pick_metadata.event_payload.number_of_choices;
                if (last_choice >= pick_metadata.event_payload.choices.length) {
                  const response = await send_slack_request(
                    'POST',
                    '/chat.postEphemeral',
                    {
                      channel: conversation_id,
                      text: 'No more restaurants to pick!',
                      blocks: [
                        {
                          type: 'section',
                          text: {
                            type: 'mrkdwn',
                            text: '*There are no more restaurants to pick.*\n\nPlease add new ones and start another pick!',
                          },
                        },
                      ],
                      user: user_id,
                    }
                  );
                  if (response.ok !== true || response.data.ok !== true) {
                    console.error(
                      `Failed sending error empheral (user: ${user_id}) message to conversation`
                    );
                    console.log(JsonKit.stringify(response.data));
                    return status(500);
                  }
                  return status(200);
                }

                pick_metadata.event_payload.choices[last_choice].shown_count++;
                pick_metadata.event_payload.number_of_choices = last_choice + 1;
                pick_metadata.event_payload.ts = Date.now();

                const message_payload = get_pick_payload(
                  conversation_id,
                  pick_metadata.event_payload.choices,
                  pick_metadata.event_payload.number_of_choices
                );
                let response = await send_slack_request(
                  'POST',
                  '/chat.update',
                  {
                    ts: message_ts,
                    ...message_payload,
                  }
                );
                if (response.ok !== true || response.data.ok !== true) {
                  console.error(
                    'Failed updating pick message to add choice in conversation'
                  );
                  console.log(JsonKit.stringify(response.data));
                  return status(500);
                }

                const bookmark = await retrieve_bookmark(conversation_id);
                if (bookmark != null) {
                  const data = JsonKit.parse(
                    bookmark.link.searchParams.get('data')
                  );
                  const restaurant = data.list.find(
                    (restaurant) =>
                      restaurant.id ===
                      pick_metadata.event_payload.choices[last_choice].id
                  );
                  if (restaurant != null) {
                    restaurant.shown_count++;
                  }

                  // update bookmark
                  data.ts = Date.now();
                  const data_str = JsonKit.stringify(data, {
                    extended: false,
                    minify: false,
                    compress: true,
                  });
                  response = await send_slack_request(
                    'POST',
                    '/bookmarks.edit',
                    {
                      channel_id: conversation_id,
                      bookmark_id: bookmark.id,
                      link: `${APP_ENDPOINT}/?conversation=${conversation_id}&data=${data_str}`,
                    }
                  );
                  if (response.ok !== true || response.data.ok !== true) {
                    console.error(
                      'Failed editing bookmark in conversation after pick'
                    );
                    console.log(JsonKit.stringify(response.data));
                  }
                }

                const voted_users = [
                  ...new Set(
                    pick_metadata.event_payload.choices.flatMap((c) =>
                      c.votes.map((v) => v.user_id)
                    )
                  ),
                ];
                for (const user of voted_users) {
                  response = await send_slack_request(
                    'POST',
                    '/chat.postEphemeral',
                    {
                      channel: conversation_id,
                      text: `<@${user}> A new choice has been added! You may consider changing your vote.`,
                      user: user,
                    }
                  );
                  if (response.ok !== true || response.data.ok !== true) {
                    console.error(
                      `Failed sending new choice notification empheral (user: ${user}) message to conversation`
                    );
                    console.log(JsonKit.stringify(response.data));
                  }
                }

                return status(200);
              }
              case 'pick_restaurant_pick_end-action': {
                if (
                  typeof conversation_id !== 'string' ||
                  typeof message_ts !== 'string'
                ) {
                  return status(400);
                }
                const response = await send_slack_request(
                  'POST',
                  '/views.open',
                  {
                    trigger_id,
                    view: {
                      type: 'modal',
                      title: {
                        type: 'plain_text',
                        text: 'End Vote',
                        emoji: true,
                      },
                      close: {
                        type: 'plain_text',
                        text: 'No',
                        emoji: true,
                      },
                      submit: {
                        type: 'plain_text',
                        text: 'Yes',
                        emoji: true,
                      },
                      private_metadata: JsonKit.stringify({
                        conversation: conversation_id,
                        message_ts,
                        user_id,
                      }),
                      callback_id: 'pick_restaurant-pick_end',
                      blocks: [
                        {
                          type: 'section',
                          text: {
                            type: 'mrkdwn',
                            text: 'Are you sure you want to end the vote now?\n\n*This action is irreversible!*',
                          },
                        },
                      ],
                    },
                  }
                );
                if (response.ok !== true || response.data.ok !== true) {
                  console.error('Failed opening end vote confirmation modal');
                  console.log(JsonKit.stringify(response.data));
                  return status(500);
                }
                return status(200);
              }
              case 'list_action-action': {
                switch (action.type) {
                  case 'overflow': {
                    const private_metadata = JsonKit.parse(
                      payload.view.private_metadata
                    );
                    const conversation = private_metadata.conversation;
                    const data = JsonKit.parse(private_metadata.data);
                    const restaurant_id = action.block_id;
                    const restaurant = data.list.find(
                      (r) => r.id === restaurant_id
                    );
                    if (restaurant == null) {
                      console.error(
                        'Restaurant not found for list_action-action'
                      );
                      return status(500);
                    }
                    switch (action.selected_option.value) {
                      case 'edit': {
                        const response = await send_slack_request(
                          'POST',
                          '/views.push',
                          {
                            trigger_id,
                            view: {
                              type: 'modal',
                              title: {
                                type: 'plain_text',
                                text: 'Edit Restarurant',
                                emoji: true,
                              },
                              close: {
                                type: 'plain_text',
                                text: 'Cancel',
                                emoji: true,
                              },
                              submit: {
                                type: 'plain_text',
                                text: 'Save',
                                emoji: true,
                              },
                              private_metadata: JsonKit.stringify({
                                conversation: conversation,
                                list_view: view_id,
                                data_ts: data.ts,
                                restaurant_id,
                              }),
                              callback_id: 'pick_restaurant-edit',
                              blocks: [
                                {
                                  block_id: 'restaurant_name-block',
                                  type: 'input',
                                  element: {
                                    type: 'plain_text_input',
                                    action_id: 'restaurant_name-action',
                                    placeholder: {
                                      type: 'plain_text',
                                      text: 'Name of Restaurant',
                                    },
                                    initial_value: restaurant.name,
                                    min_length: 2,
                                    max_length: 30,
                                  },
                                  label: {
                                    type: 'plain_text',
                                    text: 'Name',
                                  },
                                },
                                {
                                  block_id: 'restaurant_weight-block',
                                  type: 'input',
                                  element: {
                                    type: 'number_input',
                                    action_id: 'restaurant_weight-action',
                                    is_decimal_allowed: false,
                                    placeholder: {
                                      type: 'plain_text',
                                      text: 'Weight (0 [disabled] - 99)',
                                    },
                                    initial_value: restaurant.weight.toString(),
                                    min_value: '0',
                                    max_value: '99',
                                    focus_on_load: true,
                                  },
                                  label: {
                                    type: 'plain_text',
                                    text: 'Weight',
                                  },
                                },
                              ],
                            },
                          }
                        );
                        if (response.ok !== true || response.data.ok !== true) {
                          console.error('Failed opening edit modal');
                          console.log(JsonKit.stringify(response.data));
                          return status(500);
                        }
                        return status(200);
                      }
                      case 'remove': {
                        const private_metadata = JsonKit.parse(
                          payload.view.private_metadata
                        );
                        const conversation = private_metadata.conversation;
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

                        const data = JsonKit.parse(
                          bookmark.link.searchParams.get('data')
                        );
                        if (!validate_data(conversation, data)) {
                          // TODO: call pick_restaurant_repair
                          console.error('Invalid bookmark data');
                          return status(500);
                        }

                        const restaurant_idx = data.list.findIndex(
                          (r) => r.id === restaurant_id
                        );
                        if (restaurant_idx < 0) {
                          return status(200);
                        }

                        data.list.splice(restaurant_idx, 1);

                        // update bookmark
                        data.ts = Date.now();
                        const data_str = JsonKit.stringify(data, {
                          extended: false,
                          minify: false,
                          compress: true,
                        });
                        const response = await send_slack_request(
                          'POST',
                          '/bookmarks.edit',
                          {
                            channel_id: conversation,
                            bookmark_id: bookmark.id,
                            link: `${APP_ENDPOINT}/?conversation=${conversation}&data=${data_str}`,
                          }
                        );
                        if (response.ok !== true || response.data.ok !== true) {
                          console.error(
                            'Failed editing bookmark in conversation after edit'
                          );
                          console.log(JsonKit.stringify(response.data));
                          return status(500);
                        }
                        return await list_action(conversation, view_id, true);
                      }
                      default: {
                        console.error(
                          'Received unknown block action overflow selected option interaction payload'
                        );
                        console.log(JsonKit.stringify(payload));
                        return status(400);
                      }
                    }
                  }
                  default: {
                    console.error(
                      'Received unknown block action type interaction payload'
                    );
                    console.log(JsonKit.stringify(payload));
                    return status(400);
                  }
                }
              }
              default: {
                console.error(
                  'Received unknown block action interaction payload'
                );
                console.log(JsonKit.stringify(payload));
                return status(400);
              }
            }
          }
          return status(200);
        }
        default: {
          console.error('Received unknown interaction payload');
          console.log(JsonKit.stringify(payload));
          break;
        }
      }
    }
  }
  return status(400);
}
