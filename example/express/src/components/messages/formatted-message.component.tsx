import { context } from "aidk";
import { type Message as MessageType, MessageRole } from "aidk/content";
import { Message, Paragraph, Text } from "aidk/jsx/components";

export interface FormattedMessageProps {
  message: MessageType;
  key?: string;
}

export function FormattedMessage({ message, key }: FormattedMessageProps) {
  const startedAt = context().origin?.startedAt;
  const isHistorical = message.createdAt && message.createdAt < startedAt;
  const isUserMessage = message.role === MessageRole.USER;

  let content = message.content;
  if (isHistorical && isUserMessage) {
    content = [
      { type: 'text', text: `[${message.createdAt.toLocaleString()}]` },
      ...message.content
    ];
  }

  return (
    <Message id={message.id || key} {...message}>
      {content.map((block, i) => {
        if (!isHistorical) {
          return block;
        }

        const blockId = block.id || `msg_${message.id}_${i}`;

        if (block.type === 'image') {
          return (
            <Text id={blockId}>
              [Summarized image content]: {block.altText}
              {block.source.type === 'url' && (
                <Paragraph>[Image url]: {block.source.url}</Paragraph>
              )}
            </Text>
          );
        } else if (block.type === 'audio') {
          return (
            <Text id={blockId}>
              [Audio transcript]: {block.transcript}
            </Text>
          );
        } else if (block.type === 'video') {
          return (
            <Text id={blockId}>
              [Summarized video content]: {block.transcript}
              {block.source.type === 'url' && (
                <Paragraph>[Video url]: {block.source.url}</Paragraph>
              )}
            </Text>
          );
        } else if (block.type === 'document') {
          return (
            <Text id={blockId}>
              [Document title]: <strong>{block.title}</strong>
              {block.source.type === 'url' && (
                <Paragraph>[Document url]: {block.source.url}</Paragraph>
              )}
            </Text>
          );
        }

        return block;
      })}
    </Message>
  );
}