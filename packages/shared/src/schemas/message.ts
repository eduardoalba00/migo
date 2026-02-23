import { z } from "zod/v4";

export const sendMessageSchema = z
  .object({
    content: z.string().max(4000, "Message must be at most 4000 characters").default(""),
    replyToId: z.string().optional(),
    attachmentIds: z.array(z.string()).optional(),
  })
  .refine((data) => data.content.trim().length > 0 || (data.attachmentIds && data.attachmentIds.length > 0), {
    message: "Message content or attachments required",
  });

export const editMessageSchema = z.object({
  content: z
    .string()
    .min(1, "Message content is required")
    .max(4000, "Message must be at most 4000 characters"),
});

export const getMessagesSchema = z.object({
  before: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

export type SendMessageInput = z.infer<typeof sendMessageSchema>;
export type EditMessageInput = z.infer<typeof editMessageSchema>;
export type GetMessagesInput = z.infer<typeof getMessagesSchema>;
