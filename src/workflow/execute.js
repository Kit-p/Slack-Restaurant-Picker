import { pick_action } from '../action/pick';

import { send_slack_request } from '../util/request';

export async function pick_workflow_execute(event) {
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
    if (typeof number_of_choices !== 'number' || number_of_choices <= 0) {
      throw new Error(
        'Missing number of choices, please reconfigure the workflow step.'
      );
    }

    await pick_action(selected_conversation, number_of_choices);

    await send_slack_request('POST', '/workflows.stepCompleted', {
      workflow_step_execute_id: event.workflow_step.workflow_step_execute_id,
    });

    return true;
  } catch (err) {
    console.error(err);
    await send_slack_request('POST', '/workflows.stepFailed', {
      workflow_step_execute_id: event.workflow_step.workflow_step_execute_id,
      error: {
        message: err.message.toString(),
      },
    });
    return false;
  }
}
