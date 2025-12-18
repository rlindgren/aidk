import { Component, MessageRole, TextBlock } from "aidk";
import { Text } from "aidk/jsx/components/content";
import { Message, MessageRoles } from "aidk/content";
import { input } from "aidk/state/use-state";

export interface FormattedTextBlockProps {
  block: TextBlock;
  message: Message;
  role: MessageRoles;
  historical: boolean;
}

export class FormattedTextBlock extends Component<FormattedTextBlockProps> {
  block = input<TextBlock>();
  message = input<Message>();
  role = input<MessageRoles>();
  historical = input<boolean>(false);

  render() {
    const showTimestamp = this.historical() && this.role() === MessageRole.USER;

    // Don't mutate block.text - render timestamp separately
    return (
      <Text {...this.block()}>
        {(showTimestamp && `[${new Date(this.message().created_at).toLocaleString()}] `) || ''}
        {this.block().text}
      </Text>
    );
  }
}