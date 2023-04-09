import { action_handler } from '../action';

export async function command_handler(command) {
  return await action_handler(command);
}
