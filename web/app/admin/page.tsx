"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabase";
import { AuditLogRow, formatAuditAction, recordAuditLog } from "@/lib/audit-log";
import {
  hasAdminSession,
  isAdminConfigured,
  setAdminSession,
  validateAdminCredentials,
} from "@/lib/admin-auth";
import {
  BookingPdfRow,
  downloadBookingsPdf,
  formatDateToBrShort,
  formatPhoneToBr,
} from "@/lib/booking-pdf";

type AdminBookingRow = BookingPdfRow & {
  id: string;
};

type BookingSlotRow = {
  id: string;
  slot_time: string;
};

type DateOption = {
  label: string;
  value: string;
};

type Slot = {
  label: string;
  value: string;
  isLunch: boolean;
};

const DATE_OPTIONS: DateOption[] = [
  { label: "Sábado • 22/08/2026", value: "2026-08-22" },
  { label: "Domingo • 23/08/2026", value: "2026-08-23" },
];

const START_MINUTES = 7 * 60 + 15;
const END_MINUTES_SATURDAY = 20 * 60 + 30;
const END_MINUTES_SUNDAY = 13 * 60;
const STEP_MINUTES = 15;
const LUNCH_START = 12 * 60;
const LUNCH_END = 13 * 60;
const HIDDEN_SATURDAY_TIMES = new Set(["12:15", "12:30", "12:45"]);

const toTimeLabel = (minutes: number) => {
  const hour = Math.floor(minutes / 60)
    .toString()
    .padStart(2, "0");
  const min = (minutes % 60).toString().padStart(2, "0");
  return `${hour}:${min}`;
};

const getSlotsForDate = (date: string): Slot[] => {
  const isSunday = date === "2026-08-23";
  const endMinutes = isSunday ? END_MINUTES_SUNDAY : END_MINUTES_SATURDAY;

  return Array.from(
    { length: Math.floor((endMinutes - START_MINUTES) / STEP_MINUTES) + 1 },
    (_, idx) => {
      const minutePoint = START_MINUTES + idx * STEP_MINUTES;
      const label = toTimeLabel(minutePoint);
      if (!isSunday && HIDDEN_SATURDAY_TIMES.has(label)) {
        return null;
      }

      const isLunch =
        !isSunday && minutePoint >= LUNCH_START && minutePoint < LUNCH_END;

      return {
        label,
        value: `${label}:00`,
        isLunch,
      };
    }
  ).filter((slot): slot is Slot => slot !== null);
};

export default function AdminPage() {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [isAuthenticated, setIsAuthenticated] = useState(() => hasAdminSession());
  const [isLoggingIn, setIsLoggingIn] = useState(false);
  const [isLoadingBookings, setIsLoadingBookings] = useState(false);
  const [isLoadingLogs, setIsLoadingLogs] = useState(false);
  const [isExportingLogs, setIsExportingLogs] = useState(false);
  const [isExportingPdf, setIsExportingPdf] = useState(false);
  const [isLoadingSlots, setIsLoadingSlots] = useState(false);
  const [cancelingId, setCancelingId] = useState<string | null>(null);
  const [isFinalizing, setIsFinalizing] = useState(false);
  const [bookings, setBookings] = useState<AdminBookingRow[]>([]);
  const [auditLogs, setAuditLogs] = useState<AuditLogRow[]>([]);
  const [isLogsOpen, setIsLogsOpen] = useState(false);
  const [occupiedSlots, setOccupiedSlots] = useState<Set<string>>(new Set());
  const [pendingCancelBooking, setPendingCancelBooking] = useState<AdminBookingRow | null>(null);
  const [pendingRescheduleBooking, setPendingRescheduleBooking] = useState<AdminBookingRow | null>(null);
  const [rescheduleTarget, setRescheduleTarget] = useState<AdminBookingRow | null>(null);
  const [rescheduleDate, setRescheduleDate] = useState(DATE_OPTIONS[0].value);
  const [rescheduleSlot, setRescheduleSlot] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const rescheduleSlots = useMemo(
    () => getSlotsForDate(rescheduleDate),
    [rescheduleDate]
  );

  const fetchBookings = useCallback(async () => {
    if (!supabase) return;

    setIsLoadingBookings(true);
    setErrorMessage(null);

    const { data, error } = await supabase
      .from("bookings")
      .select("id, event_date, slot_time, person1, person2, phone1, class_name")
      .eq("status", "active")
      .order("event_date", { ascending: true })
      .order("slot_time", { ascending: true });

    setIsLoadingBookings(false);

    if (error) {
      if (error.code === "42703") {
        setErrorMessage("A coluna de categoria ainda não existe no banco. Rode novamente o schema.sql no Supabase.");
      } else {
        setErrorMessage("Não foi possível carregar a lista do admin agora.");
      }
      return;
    }

    setBookings((data as AdminBookingRow[]) ?? []);
  }, []);

  useEffect(() => {
    if (!isAuthenticated || !supabase) return;

    const loadBookings = async () => {
      await fetchBookings();
    };

    void loadBookings();
  }, [fetchBookings, isAuthenticated]);

  useEffect(() => {
    const client = supabase;
    if (!isAuthenticated || !client) return;

    const channel = client
      .channel("admin-bookings-realtime")
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "bookings",
        },
        () => {
          void fetchBookings();
        }
      )
      .subscribe();

    return () => {
      void client.removeChannel(channel);
    };
  }, [fetchBookings, isAuthenticated]);

  const groupedSummary = useMemo(() => {
    return bookings.reduce<Record<string, number>>((acc, booking) => {
      const key = booking.class_name || "Sem categoria";
      acc[key] = (acc[key] || 0) + 1;
      return acc;
    }, {});
  }, [bookings]);

  const fetchOccupiedSlots = useCallback(
    async (date: string, currentBookingId?: string) => {
      if (!supabase) return false;

      setIsLoadingSlots(true);

      const { data, error } = await supabase
        .from("bookings")
        .select("id, slot_time")
        .eq("event_date", date)
        .eq("status", "active");

      setIsLoadingSlots(false);

      if (error) {
        setErrorMessage("Não foi possível carregar os horários para remarcação.");
        return false;
      }

      const reserved = new Set(
        ((data as BookingSlotRow[]) ?? [])
          .filter((booking) => booking.id !== currentBookingId)
          .map((booking) => booking.slot_time.slice(0, 8))
      );

      setOccupiedSlots(reserved);
      return true;
    },
    []
  );

  const fetchAuditLogs = useCallback(async () => {
    if (!supabase) return;

    setIsLoadingLogs(true);
    setErrorMessage(null);

    const { data, error } = await supabase
      .from("audit_logs")
      .select("id, action, actor_role, actor_label, booking_id, booking_person1, booking_person2, class_name, phone1, from_event_date, from_slot_time, to_event_date, to_slot_time, created_at")
      .order("created_at", { ascending: false })
      .limit(200);

    setIsLoadingLogs(false);

    if (error) {
      setErrorMessage("Não foi possível carregar os logs agora. Rode o schema.sql no Supabase.");
      return;
    }

    setAuditLogs((data as AuditLogRow[]) ?? []);
  }, []);

  const getAuditScheduleLabel = useCallback((log: AuditLogRow) => {
    if (log.action === "created" && log.to_event_date && log.to_slot_time) {
      return `${formatDateToBrShort(log.to_event_date)} às ${log.to_slot_time.slice(0, 5)}`;
    }

    if (log.action === "cancelled" && log.from_event_date && log.from_slot_time) {
      return `${formatDateToBrShort(log.from_event_date)} às ${log.from_slot_time.slice(0, 5)}`;
    }

    if (log.from_event_date && log.from_slot_time && log.to_event_date && log.to_slot_time) {
      return `${formatDateToBrShort(log.from_event_date)} ${log.from_slot_time.slice(0, 5)} -> ${formatDateToBrShort(log.to_event_date)} ${log.to_slot_time.slice(0, 5)}`;
    }

    return "-";
  }, []);

  const handleDownloadLogsExcel = () => {
    if (auditLogs.length === 0) {
      setMessage("Não há logs para exportar.");
      return;
    }

    setIsExportingLogs(true);
    setErrorMessage(null);
    setMessage(null);

    const escapeCsv = (value: string) => `"${value.replaceAll('"', '""')}"`;
    const header = [
      "Quando",
      "Acao",
      "Quem",
      "Papel",
      "Casal",
      "Categoria",
      "Telefone",
      "Horario",
    ];

    const rows = auditLogs.map((log) => [
      new Date(log.created_at).toLocaleString("pt-BR"),
      formatAuditAction(log.action),
      log.actor_label,
      log.actor_role,
      `${log.booking_person1} e ${log.booking_person2}`,
      log.class_name || "-",
      log.phone1 ? formatPhoneToBr(log.phone1) : "-",
      getAuditScheduleLabel(log),
    ]);

    const csvContent = [header, ...rows]
      .map((row) => row.map((cell) => escapeCsv(cell)).join(";"))
      .join("\r\n");

    const blob = new Blob([`\uFEFF${csvContent}`], {
      type: "text/csv;charset=utf-8;",
    });
    const url = window.URL.createObjectURL(blob);
    const link = document.createElement("a");
    const fileDate = new Date().toISOString().slice(0, 10);

    link.href = url;
    link.download = `logs-auditoria-${fileDate}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    window.URL.revokeObjectURL(url);

    setIsExportingLogs(false);
    setMessage("Logs exportados com sucesso.");
  };

  const handleLogin = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    setIsLoggingIn(true);
    setErrorMessage(null);
    setMessage(null);

    const result = await validateAdminCredentials(username, password);
    setIsLoggingIn(false);

    if (!result.ok) {
      if (result.reason === "not-configured") {
        setErrorMessage("Login admin não configurado. Defina os hashes do usuário e senha no build.");
      } else {
        setErrorMessage("Usuário ou senha inválidos.");
      }
      return;
    }

    setAdminSession(true);
    setIsAuthenticated(true);
    setPassword("");
    setMessage("Login admin realizado com sucesso.");
  };

  const handleLogout = () => {
    setAdminSession(false);
    setIsAuthenticated(false);
    setBookings([]);
    setMessage(null);
    setErrorMessage(null);
  };

  const handleDownloadPdf = async () => {
    if (bookings.length === 0) {
      setMessage("Não há horários marcados para exportar.");
      return;
    }

    setIsExportingPdf(true);
    setErrorMessage(null);
    setMessage(null);

    await downloadBookingsPdf(bookings, {
      title: "Relatório administrativo de horários marcados",
      filenamePrefix: "horarios-marcados-admin",
      includeCategory: true,
    });

    setIsExportingPdf(false);
    setMessage("PDF do admin gerado com sucesso.");
  };

  const handleCancelBooking = async (bookingId: string) => {
    if (!supabase) return;

    const booking = bookings.find((item) => item.id === bookingId);

    setCancelingId(bookingId);
    setErrorMessage(null);
    setMessage(null);

    const { error } = await supabase
      .from("bookings")
      .update({ status: "cancelled", canceled_at: new Date().toISOString() })
      .eq("id", bookingId)
      .eq("status", "active");

    setCancelingId(null);

    if (error) {
      setErrorMessage("Não foi possível cancelar a reserva agora.");
      return;
    }

    if (booking) {
      void recordAuditLog({
        action: "cancelled",
        actorRole: "admin",
        actorLabel: "Administrador",
        bookingId: booking.id,
        bookingPerson1: booking.person1,
        bookingPerson2: booking.person2,
        className: booking.class_name,
        phone1: booking.phone1,
        fromEventDate: booking.event_date,
        fromSlotTime: booking.slot_time,
      });
    }

    setMessage("Reserva cancelada com sucesso.");
    await fetchBookings();
  };

  const handleRequestCancel = (booking: AdminBookingRow) => {
    setPendingCancelBooking(booking);
    setErrorMessage(null);
    setMessage(null);
  };

  const handleConfirmCancel = async () => {
    if (!pendingCancelBooking) return;

    const bookingId = pendingCancelBooking.id;
    setPendingCancelBooking(null);
    await handleCancelBooking(bookingId);
  };

  const handleRequestReschedule = (booking: AdminBookingRow) => {
    setPendingRescheduleBooking(booking);
    setErrorMessage(null);
    setMessage(null);
  };

  const handleConfirmRescheduleRequest = async () => {
    if (!pendingRescheduleBooking) return;

    const booking = pendingRescheduleBooking;
    setPendingRescheduleBooking(null);
    await handleOpenReschedule(booking);
  };

  const handleOpenReschedule = async (booking: AdminBookingRow) => {
    setErrorMessage(null);
    setMessage(null);
    setRescheduleTarget(booking);
    setRescheduleDate(booking.event_date);
    setRescheduleSlot(booking.slot_time.slice(0, 8));
    await fetchOccupiedSlots(booking.event_date, booking.id);
  };

  const handleConfirmReschedule = async () => {
    if (!supabase || !rescheduleTarget || !rescheduleSlot) return;

    setIsFinalizing(true);
    setErrorMessage(null);

    const { error } = await supabase
      .from("bookings")
      .update({
        event_date: rescheduleDate,
        slot_time: rescheduleSlot,
      })
      .eq("id", rescheduleTarget.id)
      .eq("status", "active");

    setIsFinalizing(false);

    if (error) {
      if (error.code === "23505") {
        setErrorMessage("Esse horário já está ocupado. Escolha outro.");
      } else {
        setErrorMessage("Não foi possível remarcar a reserva agora.");
      }
      return;
    }

    void recordAuditLog({
      action: "rescheduled",
      actorRole: "admin",
      actorLabel: "Administrador",
      bookingId: rescheduleTarget.id,
      bookingPerson1: rescheduleTarget.person1,
      bookingPerson2: rescheduleTarget.person2,
      className: rescheduleTarget.class_name,
      phone1: rescheduleTarget.phone1,
      fromEventDate: rescheduleTarget.event_date,
      fromSlotTime: rescheduleTarget.slot_time,
      toEventDate: rescheduleDate,
      toSlotTime: rescheduleSlot,
    });

    setRescheduleTarget(null);
    setRescheduleSlot(null);
    setOccupiedSlots(new Set());
    setMessage("Reserva remarcada com sucesso.");
    await fetchBookings();
  };

  const handleCloseReschedule = () => {
    setRescheduleTarget(null);
    setRescheduleSlot(null);
    setOccupiedSlots(new Set());
  };

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-6xl flex-col px-4 py-8 sm:px-6 lg:px-8">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-xs font-semibold tracking-[0.2em] text-[var(--brand)] uppercase">
            Painel Admin
          </p>
          <h1 className="mt-1 text-3xl text-slate-900">Reservas do encontro</h1>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link
            href="/"
            className="rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
          >
            Voltar ao site
          </Link>
          {isAuthenticated && (
            <button
              type="button"
              onClick={handleLogout}
              className="rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
            >
              Sair
            </button>
          )}
        </div>
      </div>

      {!supabase && (
        <div className="rounded-2xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          Configure o Supabase para habilitar a leitura do painel admin.
        </div>
      )}

      {!isAuthenticated ? (
        <section className="panel-glow mx-auto w-full max-w-md rounded-3xl border border-white/70 p-6">
          <h2 className="text-2xl text-slate-900">Login do administrador</h2>
          <p className="mt-2 text-sm text-slate-600">
            Esta proteção funciona como barreira de interface no GitHub Pages. Para proteção real de dados, o banco também precisa de políticas privadas.
          </p>

          {!isAdminConfigured() && (
            <p className="mt-4 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
              Defina os hashes de usuário e senha do admin no ambiente antes de publicar.
            </p>
          )}

          <form onSubmit={handleLogin} className="mt-5 space-y-3">
            <input
              type="text"
              placeholder="Usuário"
              value={username}
              onChange={(event) => setUsername(event.target.value)}
              className="w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm outline-none transition focus:border-[var(--brand)]"
              required
            />
            <input
              type="password"
              placeholder="Senha"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              className="w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm outline-none transition focus:border-[var(--brand)]"
              required
            />
            <button
              type="submit"
              disabled={isLoggingIn}
              className="w-full rounded-xl bg-[var(--brand)] px-4 py-3 text-sm font-semibold text-white transition hover:brightness-105 disabled:opacity-60"
            >
              {isLoggingIn ? "Entrando..." : "Entrar como admin"}
            </button>
          </form>
        </section>
      ) : (
        <section className="space-y-6">
          <div className="grid gap-4 lg:grid-cols-[0.7fr_1.3fr]">
            <article className="panel-glow rounded-3xl border border-white/70 p-5">
              <div className="flex items-center justify-between gap-3">
                <h2 className="text-xl text-slate-900">Resumo</h2>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setIsLogsOpen(true);
                      void fetchAuditLogs();
                    }}
                    disabled={isLoadingLogs}
                    className="rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 disabled:opacity-60"
                  >
                    {isLoadingLogs ? "Carregando logs..." : "Ver logs"}
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleDownloadPdf()}
                    disabled={isExportingPdf || isLoadingBookings}
                    className="rounded-xl border border-indigo-300 bg-indigo-50 px-4 py-2 text-sm font-semibold text-indigo-700 transition hover:bg-indigo-100 disabled:opacity-60"
                  >
                    {isExportingPdf ? "Gerando PDF..." : "Baixar horários"}
                  </button>
                </div>
              </div>
              <p className="mt-2 text-sm text-slate-600">
                Total de reservas ativas: <span className="font-semibold text-slate-900">{bookings.length}</span>
              </p>
              <div className="mt-4 space-y-2">
                {Object.entries(groupedSummary).length === 0 ? (
                  <p className="text-sm text-slate-500">Nenhuma categoria registrada ainda.</p>
                ) : (
                  Object.entries(groupedSummary).map(([key, value]) => (
                    <div key={key} className="flex items-center justify-between rounded-xl bg-slate-50 px-3 py-2 text-sm">
                      <span className="text-slate-700">{key}</span>
                      <span className="font-semibold text-slate-900">{value}</span>
                    </div>
                  ))
                )}
              </div>
            </article>

            <article className="panel-glow rounded-3xl border border-white/70 p-5">
              <div className="flex items-center justify-between gap-3">
                <h2 className="text-xl text-slate-900">Lista de reservas</h2>
                {isLoadingBookings && <span className="text-sm text-slate-500">Atualizando...</span>}
              </div>

              <div className="mt-4 overflow-x-auto">
                <table className="min-w-full divide-y divide-slate-200 text-sm">
                  <thead>
                    <tr className="text-left text-slate-500">
                      <th className="px-3 py-2 font-semibold">Data</th>
                      <th className="px-3 py-2 font-semibold">Horário</th>
                      <th className="px-3 py-2 font-semibold">Casal</th>
                      <th className="px-3 py-2 font-semibold">Categoria</th>
                      <th className="min-w-[140px] px-3 py-2 font-semibold">Telefone</th>
                      <th className="px-3 py-2 font-semibold">Ações</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {bookings.length === 0 ? (
                      <tr>
                        <td colSpan={6} className="px-3 py-8 text-center text-slate-500">
                          Nenhuma reserva ativa encontrada.
                        </td>
                      </tr>
                    ) : (
                      bookings.map((booking) => (
                        <tr key={booking.id}>
                          <td className="px-3 py-3 text-slate-700">{formatDateToBrShort(booking.event_date)}</td>
                          <td className="px-3 py-3 text-slate-700">{booking.slot_time.slice(0, 5)}</td>
                          <td className="px-3 py-3 font-medium text-slate-900">{booking.person1} e {booking.person2}</td>
                          <td className="px-3 py-3 text-slate-700">{booking.class_name || "-"}</td>
                          <td className="min-w-[140px] px-3 py-3 font-medium whitespace-nowrap tabular-nums text-slate-700">{formatPhoneToBr(booking.phone1)}</td>
                          <td className="px-3 py-3">
                            <div className="flex flex-wrap gap-2">
                              <button
                                type="button"
                                onClick={() => handleRequestReschedule(booking)}
                                disabled={cancelingId === booking.id || isFinalizing}
                                className="rounded-lg border border-emerald-300 bg-emerald-50 px-3 py-2 text-xs font-semibold text-emerald-700 transition hover:bg-emerald-100 disabled:opacity-60"
                              >
                                Remarcar
                              </button>
                              <button
                                type="button"
                                onClick={() => handleRequestCancel(booking)}
                                disabled={cancelingId === booking.id || isFinalizing}
                                className="rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-xs font-semibold text-red-700 transition hover:bg-red-100 disabled:opacity-60"
                              >
                                {cancelingId === booking.id ? "Cancelando..." : "Cancelar"}
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </article>
          </div>
        </section>
      )}

      {errorMessage && (
        <p className="mt-4 rounded-xl border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-800">
          {errorMessage}
        </p>
      )}

      {message && (
        <p className="mt-4 rounded-xl border border-green-300 bg-green-50 px-4 py-3 text-sm text-green-800">
          {message}
        </p>
      )}

      {rescheduleTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4">
          <div className="flex max-h-[90vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-indigo-300 bg-white shadow-2xl">
            <div className="flex items-center justify-between gap-3 border-b border-slate-200 px-5 py-4">
              <div>
                <h3 className="text-lg font-semibold text-slate-900">Remarcar reserva</h3>
                <p className="mt-1 text-sm text-slate-600">
                  {rescheduleTarget.person1} e {rescheduleTarget.person2} | Atual: {formatDateToBrShort(rescheduleTarget.event_date)} às {rescheduleTarget.slot_time.slice(0, 5)}
                </p>
              </div>
              <button
                type="button"
                onClick={handleCloseReschedule}
                disabled={isFinalizing}
                className="rounded-lg border border-slate-300 bg-white px-3 py-1 text-xs font-semibold text-slate-700 transition hover:bg-slate-50 disabled:opacity-60"
              >
                Fechar
              </button>
            </div>

            <div className="overflow-y-auto px-5 py-4">
              <div className="grid gap-3 sm:grid-cols-2">
                {DATE_OPTIONS.map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    onClick={() => {
                      setRescheduleDate(option.value);
                      setRescheduleSlot(null);
                      void fetchOccupiedSlots(option.value, rescheduleTarget.id);
                    }}
                    className={`rounded-2xl border px-4 py-3 text-sm font-semibold transition-all duration-300 ${
                      rescheduleDate === option.value
                        ? "border-[var(--brand)] bg-[var(--brand)] text-white shadow-md"
                        : "border-slate-200 bg-white text-slate-700 hover:border-[var(--brand)] hover:text-[var(--brand)]"
                    }`}
                  >
                    {option.label}
                  </button>
                ))}
              </div>

              <div className="mt-5 pb-1">
                <h4 className="text-base font-semibold text-slate-900">Escolha o novo horário</h4>
                {isLoadingSlots ? (
                  <div className="mt-3 grid grid-cols-3 gap-2 sm:grid-cols-4 md:grid-cols-5">
                    {Array.from({ length: 20 }).map((_, idx) => (
                      <div key={idx} className="h-11 animate-pulse rounded-xl bg-slate-200" />
                    ))}
                  </div>
                ) : (
                  <div className="mt-3 grid grid-cols-3 gap-2 sm:grid-cols-4 md:grid-cols-5">
                    {rescheduleSlots.map((slot) => {
                      const isReserved = occupiedSlots.has(slot.value);
                      const isBlocked = slot.isLunch || isReserved;
                      const isSelected = rescheduleSlot === slot.value;

                      return (
                        <button
                          key={slot.value}
                          type="button"
                          disabled={isBlocked}
                          onClick={() => setRescheduleSlot(slot.value)}
                          className={`h-11 rounded-xl border text-sm font-semibold transition-all duration-200 ${
                            slot.isLunch
                              ? "cursor-not-allowed border-slate-300 bg-[var(--muted)]/45 text-slate-600"
                              : isReserved
                                ? "cursor-not-allowed border-red-300 bg-[var(--danger)]/20 text-red-700"
                                : isSelected
                                  ? "border-[var(--brand)] bg-[var(--brand)] text-white shadow-md"
                                  : "border-green-300 bg-[var(--ok)]/15 text-green-800 hover:bg-[var(--ok)]/25"
                          }`}
                        >
                          {slot.label}
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>

            <div className="flex flex-wrap justify-end gap-2 border-t border-slate-200 px-5 py-4">
              <button
                type="button"
                onClick={handleCloseReschedule}
                disabled={isFinalizing}
                className="rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 disabled:opacity-60"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={() => void handleConfirmReschedule()}
                disabled={!rescheduleSlot || isFinalizing || isLoadingSlots}
                className="rounded-xl bg-[var(--brand)] px-4 py-2 text-sm font-semibold text-white transition hover:brightness-105 disabled:opacity-60"
              >
                {isFinalizing ? "Remarcando..." : "Confirmar remarcação"}
              </button>
            </div>
          </div>
        </div>
      )}

      {pendingCancelBooking && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4">
          <div className="w-full max-w-md rounded-2xl border border-red-300 bg-white p-5 shadow-2xl">
            <h3 className="text-lg font-semibold text-slate-900">Confirmar cancelamento</h3>
            <p className="mt-2 text-sm text-slate-600">
              Deseja cancelar a reserva de {pendingCancelBooking.person1} e {pendingCancelBooking.person2} em {formatDateToBrShort(pendingCancelBooking.event_date)} às {pendingCancelBooking.slot_time.slice(0, 5)}?
            </p>
            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setPendingCancelBooking(null)}
                className="rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
              >
                Fechar
              </button>
              <button
                type="button"
                onClick={() => void handleConfirmCancel()}
                className="rounded-xl border border-red-300 bg-red-50 px-4 py-2 text-sm font-semibold text-red-700 transition hover:bg-red-100"
              >
                Confirmar
              </button>
            </div>
          </div>
        </div>
      )}

      {pendingRescheduleBooking && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4">
          <div className="w-full max-w-md rounded-2xl border border-emerald-300 bg-white p-5 shadow-2xl">
            <h3 className="text-lg font-semibold text-slate-900">Confirmar remarcação</h3>
            <p className="mt-2 text-sm text-slate-600">
              Deseja abrir a remarcação da reserva de {pendingRescheduleBooking.person1} e {pendingRescheduleBooking.person2} em {formatDateToBrShort(pendingRescheduleBooking.event_date)} às {pendingRescheduleBooking.slot_time.slice(0, 5)}?
            </p>
            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setPendingRescheduleBooking(null)}
                className="rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={() => void handleConfirmRescheduleRequest()}
                className="rounded-xl border border-emerald-300 bg-emerald-50 px-4 py-2 text-sm font-semibold text-emerald-700 transition hover:bg-emerald-100"
              >
                Confirmar
              </button>
            </div>
          </div>
        </div>
      )}

      {isLogsOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4">
          <div className="flex max-h-[90vh] w-full max-w-5xl flex-col overflow-hidden rounded-2xl border border-slate-300 bg-white shadow-2xl">
            <div className="flex items-center justify-between gap-3 border-b border-slate-200 px-5 py-4">
              <div>
                <h3 className="text-lg font-semibold text-slate-900">Logs de auditoria</h3>
                <p className="mt-1 text-sm text-slate-600">
                  Histórico de quem adicionou, cancelou e remarcou horários.
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={handleDownloadLogsExcel}
                  disabled={isExportingLogs || isLoadingLogs}
                  className="rounded-lg border border-emerald-300 bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-700 transition hover:bg-emerald-100 disabled:opacity-60"
                >
                  {isExportingLogs ? "Exportando..." : "Baixar logs em Excel"}
                </button>
                <button
                  type="button"
                  onClick={() => setIsLogsOpen(false)}
                  className="rounded-lg border border-slate-300 bg-white px-3 py-1 text-xs font-semibold text-slate-700 transition hover:bg-slate-50"
                >
                  Fechar
                </button>
              </div>
            </div>

            <div className="overflow-y-auto px-5 py-4">
              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-slate-200 text-sm">
                  <thead>
                    <tr className="text-left text-slate-500">
                      <th className="px-3 py-2 font-semibold">Quando</th>
                      <th className="px-3 py-2 font-semibold">Ação</th>
                      <th className="px-3 py-2 font-semibold">Quem</th>
                      <th className="px-3 py-2 font-semibold">Casal</th>
                      <th className="px-3 py-2 font-semibold">Categoria</th>
                      <th className="px-3 py-2 font-semibold">Horário</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {auditLogs.length === 0 ? (
                      <tr>
                        <td colSpan={6} className="px-3 py-8 text-center text-slate-500">
                          {isLoadingLogs ? "Carregando logs..." : "Nenhum log encontrado."}
                        </td>
                      </tr>
                    ) : (
                      auditLogs.map((log) => (
                        <tr key={log.id}>
                          <td className="px-3 py-3 whitespace-nowrap tabular-nums text-slate-700">
                            {new Date(log.created_at).toLocaleString("pt-BR")}
                          </td>
                          <td className="px-3 py-3 font-medium text-slate-900">{formatAuditAction(log.action)}</td>
                          <td className="px-3 py-3 text-slate-700">{log.actor_label}</td>
                          <td className="px-3 py-3 text-slate-700">{log.booking_person1} e {log.booking_person2}</td>
                          <td className="px-3 py-3 text-slate-700">{log.class_name || "-"}</td>
                          <td className="px-3 py-3 text-slate-700">
                            {getAuditScheduleLabel(log)}
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}