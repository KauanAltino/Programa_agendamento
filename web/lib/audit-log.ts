import { supabase } from "@/lib/supabase";

export type AuditAction = "created" | "cancelled" | "rescheduled";
export type AuditActorRole = "public" | "admin";

export type AuditLogInput = {
  action: AuditAction;
  actorRole: AuditActorRole;
  actorLabel: string;
  bookingId?: string | null;
  bookingPerson1: string;
  bookingPerson2: string;
  className?: string | null;
  phone1?: string | null;
  fromEventDate?: string | null;
  fromSlotTime?: string | null;
  toEventDate?: string | null;
  toSlotTime?: string | null;
};

export type AuditLogRow = {
  id: string;
  action: AuditAction;
  actor_role: AuditActorRole;
  actor_label: string;
  booking_id: string | null;
  booking_person1: string;
  booking_person2: string;
  class_name: string | null;
  phone1: string | null;
  from_event_date: string | null;
  from_slot_time: string | null;
  to_event_date: string | null;
  to_slot_time: string | null;
  created_at: string;
};

export const formatAuditAction = (action: AuditAction) => {
  if (action === "created") return "Adicionou";
  if (action === "cancelled") return "Cancelou";
  return "Remarcou";
};

export const recordAuditLog = async (input: AuditLogInput) => {
  if (!supabase) return false;

  const { error } = await supabase.from("audit_logs").insert({
    action: input.action,
    actor_role: input.actorRole,
    actor_label: input.actorLabel,
    booking_id: input.bookingId ?? null,
    booking_person1: input.bookingPerson1,
    booking_person2: input.bookingPerson2,
    class_name: input.className ?? null,
    phone1: input.phone1 ?? null,
    from_event_date: input.fromEventDate ?? null,
    from_slot_time: input.fromSlotTime ?? null,
    to_event_date: input.toEventDate ?? null,
    to_slot_time: input.toSlotTime ?? null,
  });

  return !error;
};