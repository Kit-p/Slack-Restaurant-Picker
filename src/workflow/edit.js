import { json, status } from 'itty-router-extras';
import { JsonKit } from '@kit-p/json-kit';

import { send_slack_request } from '../util/request';

export async function pick_workflow_edit(payload) {
  const has_selected_conversation =
    payload.workflow_step && payload.workflow_step.inputs.selected_conversation;
  const has_number_of_choices =
    payload.workflow_step && payload.workflow_step.inputs.number_of_choices;
  const response = await send_slack_request('POST', '/views.open', {
    trigger_id: payload.trigger_id,
    view: {
      type: 'workflow_step',
      callback_id: payload.callback_id,
      submit_disabled: false,
      blocks: [
        {
          block_id: 'conversations_select-block',
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
            action_id: 'conversations_select-action',
            focus_on_load: true,
            ...(has_selected_conversation && {
              initial_conversation:
                payload.workflow_step.inputs.selected_conversation.value,
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
          block_id: 'number_input-block',
          type: 'input',
          element: {
            type: 'number_input',
            is_decimal_allowed: false,
            placeholder: {
              type: 'plain_text',
              text: 'Enter a number between 1-9',
              emoji: true,
            },
            action_id: 'number_input-action',
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

export async function pick_workflow_edit_submit(payload) {
  const selected_conversation =
    payload.view.state.values['conversations_select-block'][
      'conversations_select-action'
    ].selected_conversation;
  if (typeof selected_conversation !== 'string') {
    return json(
      {
        response_action: 'errors',
        errors: {
          'conversations_select-block': 'Please select a channel!',
        },
      },
      { status: 200 }
    );
  }
  const number_of_choices = Number.parseInt(
    payload.view.state.values['number_input-block']['number_input-action']
      .value,
    10
  );
  if (typeof number_of_choices !== 'number' || number_of_choices <= 0) {
    return json(
      {
        response_action: 'errors',
        errors: {
          'number_input-block': 'Please enter a positive integer!',
        },
      },
      { status: 200 }
    );
  }

  // update payload
  const response = await send_slack_request('POST', '/workflows.updateStep', {
    workflow_step_edit_id: payload.workflow_step.workflow_step_edit_id,
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
  });
  if (response.ok !== true || response.data.ok !== true) {
    console.error('Failed updating workflow step');
    console.log(JsonKit.stringify(response.data));
    return status(500);
  }
  return status(200);
}
