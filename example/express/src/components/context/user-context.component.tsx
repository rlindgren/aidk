import { Context, Paragraph, Section } from "aidk";

export function UserContextComponent() {
  const ctx = Context.get();
  return (
    <>
      <Section audience="model" id="temporal-context" title="Temporal Context">
        <Paragraph>[Current Time: {new Date().toLocaleString()}]</Paragraph>
      </Section>
      <Section audience="model" id="user-context" title="User Context">
        <Paragraph>[User ID: {ctx.user.id}]</Paragraph>
        <Paragraph>[Thread ID: {ctx.metadata.threadId}]</Paragraph>
      </Section>
    </>
  );
}
