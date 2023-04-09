import { json, status } from 'itty-router-extras';
import { JsonKit } from '@kit-p/json-kit';

import { initialize_conversation } from './init';
import { list_action } from './list';

import { send_slack_request } from '../util/request';
import {
  retrieve_bookmark,
  update_bookmark,
  validate_data,
} from '../util/store';

export async function update_action(
  conversation,
  restaurant,
  data_ts,
  view_id,
  trigger_id
) {
  const response = await send_slack_request('POST', '/views.push', {
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
        data_ts,
        restaurant_id: restaurant.id,
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
  });
  if (response.ok !== true || response.data.ok !== true) {
    console.error('Failed opening edit modal');
    console.log(JsonKit.stringify(response.data));
    return status(500);
  }
  return status(200);
}

export async function update_action_submit(payload) {
  const restaurant_name =
    payload.view.state.values['restaurant_name-block']['restaurant_name-action']
      .value;
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

  const { conversation, list_view, data_ts, restaurant_id } = JsonKit.parse(
    payload.view.private_metadata
  );
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
          'restaurant_name-block': 'Data has been modified by another user!',
        },
      },
      { status: 200 }
    );
  }

  const restaurant_idx = data.list.findIndex((r) => r.id === restaurant_id);
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

  if (!(await update_bookmark(conversation, bookmark.id, data))) {
    return status(500);
  }
  return await list_action(conversation, list_view, true);
}
