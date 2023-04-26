import { json, status } from 'itty-router-extras';
import { v4 as uuid } from 'uuid';
import { JsonKit } from '@kit-p/json-kit';

import { initialize_conversation } from './init';

import { send_slack_request } from '../util/request';
import {
  retrieve_bookmark,
  update_bookmark,
  validate_data,
} from '../util/store';

export async function create_action(conversation, trigger_id) {
  const response = await send_slack_request('POST', '/views.open', {
    trigger_id,
    view: {
      type: 'modal',
      title: {
        type: 'plain_text',
        text: 'Add New Restarurant',
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
        conversation,
      }),
      callback_id: 'pick_restaurant-new',
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
            min_length: 2,
            max_length: 30,
            focus_on_load: true,
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
            initial_value: '50',
            min_value: '0',
            max_value: '99',
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
    console.error('Failed opening new modal');
    console.log(JsonKit.stringify(response.data));
    return status(500);
  }
  return status(200);
}

export async function create_action_submit(payload) {
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

  let data = JsonKit.parse(bookmark.link.searchParams.get('data'));
  if (!validate_data(conversation, data)) {
    try {
      data = repair_data_unsafe(conversation, data);
    } catch (_) {
      console.error('Invalid bookmark data');
      return status(200);
    }
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

  if (!(await update_bookmark(conversation, bookmark.id, data))) {
    return status(500);
  }
  return status(200);
}
