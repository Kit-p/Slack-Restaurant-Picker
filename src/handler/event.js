import { status } from 'itty-router-extras';
import { JsonKit } from '@kit-p/json-kit';

import { pick_workflow_execute } from '../workflow/execute';

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
          context.waitUntil(async () => await pick_workflow_execute(event));
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
