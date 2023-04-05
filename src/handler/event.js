import { status } from 'itty-router-extras';
import { JsonKit } from '@kit-p/json-kit';

import { pick_action } from '../action/pick';

import { send_slack_request } from '../util/request';

export async function event_handler(event, context) {
  const callback_id = event.callback_id;
  if (typeof callback_id !== 'string') {
    console.error('Received unknown event');
    console.log(JsonKit.stringify(event));
    return status(400);
  }

  switch (callback_id) {
    case 'pick_restaurant': {
      switch (event.type) {
        case 'workflow_step_execute': {
          context.waitUntil(
            (async () => {
              try {
                const selected_conversation =
                  event.workflow_step.inputs.selected_conversation.value;
                if (typeof selected_conversation !== 'string') {
                  throw new Error(
                    'No conversation is selected, please reconfigure the workflow step.'
                  );
                }

                const number_of_choices =
                  event.workflow_step.inputs.number_of_choices.value;
                if (
                  typeof number_of_choices !== 'number' ||
                  number_of_choices <= 0
                ) {
                  throw new Error(
                    'Missing number of choices, please reconfigure the workflow step.'
                  );
                }

                await pick_action(selected_conversation, number_of_choices);

                await send_slack_request('POST', '/workflows.stepCompleted', {
                  workflow_step_execute_id:
                    event.workflow_step.workflow_step_execute_id,
                });
              } catch (err) {
                console.error(err);
                await send_slack_request('POST', '/workflows.stepFailed', {
                  workflow_step_execute_id:
                    event.workflow_step.workflow_step_execute_id,
                  error: {
                    message: err.message.toString(),
                  },
                });
              }
            })()
          );
          return status(200);
        }
        default: {
          console.error('Received unknown event type');
          console.log(JsonKit.stringify(event));
          break;
        }
      }
      break;
    }
    default: {
      console.error('Received unknown event callback_id');
      console.log(JsonKit.stringify(event));
      break;
    }
  }

  return status(400);
}
