import { status } from 'itty-router-extras';
import { JsonKit } from '@kit-p/json-kit';

import { create_action_submit } from '../action/create';
import { delete_action } from '../action/delete';
import {
  pick_add_choice_action,
  pick_end_action,
  pick_end_action_submit,
} from '../action/pick';
import { update_action, update_action_submit } from '../action/update';
import { vote_action } from '../action/vote';

import {
  pick_workflow_edit,
  pick_workflow_edit_submit,
} from '../workflow/edit';

export async function interaction_handler(payload) {
  let callback_id = null;
  try {
    callback_id = payload.callback_id || payload.view.callback_id;
  } catch (ignored) {}

  switch (callback_id) {
    case 'pick_restaurant': {
      switch (payload.type) {
        case 'workflow_step_edit': {
          return await pick_workflow_edit(payload);
        }
        case 'view_submission': {
          return await pick_workflow_edit_submit(payload);
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
          return await create_action_submit(payload);
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
          return await update_action_submit(payload);
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
          return pick_end_action_submit(payload);
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
                  typeof message_ts !== 'string' ||
                  typeof action.value !== 'string' ||
                  typeof trigger_id !== 'string'
                ) {
                  return status(400);
                }

                return await vote_action(
                  conversation_id,
                  message_ts,
                  user_id,
                  action.value,
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

                return await pick_add_choice_action(
                  conversation_id,
                  message_ts,
                  user_id
                );
              }
              case 'pick_restaurant_pick_end-action': {
                if (
                  typeof conversation_id !== 'string' ||
                  typeof message_ts !== 'string' ||
                  typeof trigger_id !== 'string'
                ) {
                  return status(400);
                }

                return await pick_end_action(
                  conversation_id,
                  message_ts,
                  user_id,
                  trigger_id
                );
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
                        return await update_action(
                          conversation,
                          restaurant,
                          data.ts,
                          view_id,
                          trigger_id
                        );
                      }
                      case 'remove': {
                        return await delete_action(
                          conversation,
                          restaurant_id,
                          view_id
                        );
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
