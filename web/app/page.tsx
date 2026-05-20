"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";

type Booking = {
  slot_time: string;
};

type BookingForCancel = {
  id: string;
  event_date: string;
  slot_time: string;
  person1: string;
  person2: string;
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

const START_MINUTES = 7 * 60;
const END_MINUTES_SATURDAY = 20 * 60;
const END_MINUTES_SUNDAY = 12 * 60;
const STEP_MINUTES = 30;
const LUNCH_START = 12 * 60;
const LUNCH_END = 13 * 60;

const defaultFormState = {
  person1: "",
  person2: "",
  ddd1: "",
  number1: "",
};

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
      const isLunch =
        !isSunday && minutePoint >= LUNCH_START && minutePoint < LUNCH_END;

      return {
        label,
        value: `${label}:00`,
        isLunch,
      };
    }
  );
};

const formatDateToBrShort = (yyyyMmDd: string) => {
  const [year, month, day] = yyyyMmDd.split("-");
  return `${day}/${month}/${year.slice(2)}`;
};

export default function Home() {
  const [selectedDate, setSelectedDate] = useState(DATE_OPTIONS[0].value);
  const [selectedSlot, setSelectedSlot] = useState<string | null>(null);
  const [bookings, setBookings] = useState<Set<string>>(new Set());
  const [formData, setFormData] = useState(defaultFormState);
  const [isLoadingSlots, setIsLoadingSlots] = useState(Boolean(supabase));
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [cancelDdd, setCancelDdd] = useState("");
  const [cancelNumber, setCancelNumber] = useState("");
  const [cancelBookings, setCancelBookings] = useState<BookingForCancel[]>([]);
  const [isSearchingCancel, setIsSearchingCancel] = useState(false);
  const [cancelingId, setCancelingId] = useState<string | null>(null);
  const [cancelFeedback, setCancelFeedback] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const slots = useMemo(() => getSlotsForDate(selectedDate), [selectedDate]);

  const fetchBookings = useCallback(async (date: string) => {
    if (!supabase) return;

    const { data, error } = await supabase
      .from("bookings")
      .select("slot_time")
      .eq("event_date", date);

    if (error) {
      setErrorMessage("Erro ao buscar horários. Atualize a página e tente novamente.");
      setIsLoadingSlots(false);
      return;
    }

    const reserved = new Set(
      (data as Booking[]).map((booking) => booking.slot_time.slice(0, 8))
    );

    setBookings(reserved);
    setIsLoadingSlots(false);
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void fetchBookings(selectedDate);
  }, [fetchBookings, selectedDate]);

  useEffect(() => {
    const client = supabase;
    if (!client) return;

    const channel = client
      .channel("bookings-realtime")
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "bookings",
        },
        () => {
          void fetchBookings(selectedDate);
        }
      )
      .subscribe();

    return () => {
      void client.removeChannel(channel);
    };
  }, [fetchBookings, selectedDate]);

  const totalBookable = useMemo(
    () => slots.filter((slot) => !slot.isLunch).length,
    [slots]
  );

  const remainingSlots = useMemo(
    () => Math.max(totalBookable - bookings.size, 0),
    [bookings.size, totalBookable]
  );

  const canBook = !!supabase;

  const loadBookingsByPhone = useCallback(async (phone: string) => {
    if (!supabase) return;

    const { data, error } = await supabase
      .from("bookings")
      .select("id, event_date, slot_time, person1, person2")
      .or(`phone1.eq.${phone},phone2.eq.${phone}`)
      .order("event_date", { ascending: true })
      .order("slot_time", { ascending: true });

    if (error) {
      setCancelFeedback("Erro ao buscar agendamentos para cancelamento.");
      setCancelBookings([]);
      return;
    }

    const rows = (data as BookingForCancel[]) ?? [];
    if (rows.length === 0) {
      setCancelFeedback("Nenhum agendamento encontrado para esse telefone.");
      setCancelBookings([]);
      return;
    }

    setCancelFeedback(null);
    setCancelBookings(rows);
  }, []);

  const handleSearchCancel = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    const ddd = cancelDdd.trim();
    const number = cancelNumber.trim();

    if (!/^\d{2}$/.test(ddd)) {
      setCancelFeedback("Informe um DDD válido com 2 dígitos.");
      setCancelBookings([]);
      return;
    }

    if (!/^\d{8,9}$/.test(number)) {
      setCancelFeedback("Informe um número válido com 8 ou 9 dígitos.");
      setCancelBookings([]);
      return;
    }

    if (!supabase) {
      setCancelFeedback("Configuração do banco ausente para cancelar agendamento.");
      return;
    }

    setIsSearchingCancel(true);
    setCancelFeedback(null);
    await loadBookingsByPhone(`${ddd}${number}`);
    setIsSearchingCancel(false);
  };

  const handleCancelBooking = async (bookingId: string) => {
    if (!supabase) return;

    const phone = `${cancelDdd.trim()}${cancelNumber.trim()}`;
    if (!/^\d{10,11}$/.test(phone)) {
      setCancelFeedback("Telefone inválido para confirmar cancelamento.");
      return;
    }

    setCancelingId(bookingId);

    const { error } = await supabase
      .from("bookings")
      .delete()
      .eq("id", bookingId)
      .or(`phone1.eq.${phone},phone2.eq.${phone}`);

    setCancelingId(null);

    if (error) {
      setCancelFeedback("Não foi possível cancelar o agendamento agora. Tente novamente.");
      return;
    }

    setCancelFeedback("Agendamento cancelado com sucesso. Agora você pode escolher outro horário.");
    setErrorMessage(null);
    setMessage(null);
    await loadBookingsByPhone(phone);
    void fetchBookings(selectedDate);
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const client = supabase;

    if (!selectedSlot || !client) {
      setErrorMessage("Configuração do banco ausente. Configure o Supabase para habilitar reservas.");
      return;
    }

    if (!formData.person1.trim() || !formData.person2.trim()) {
      setErrorMessage("Os dois nomes do casal são obrigatórios.");
      return;
    }

    const ddd1 = formData.ddd1.trim();
    const number1 = formData.number1.trim();
    const phone1 = ddd1 + number1;

    if (!ddd1 || !number1) {
      setErrorMessage("Preencha DDD e número do telefone de contato.");
      return;
    }

    if (!/^\d{2}$/.test(ddd1)) {
      setErrorMessage("DDD deve ter 2 dígitos numéricos.");
      return;
    }

    if (!/^\d{8,9}$/.test(number1)) {
      setErrorMessage("Número deve ter 8 ou 9 dígitos numéricos.");
      return;
    }

    setErrorMessage(null);
    setMessage(null);
    setIsSubmitting(true);

    const { data: existing, error: checkError } = await client
      .from("bookings")
      .select("phone1, phone2")
      .or(`phone1.eq.${phone1},phone2.eq.${phone1}`);

    if (checkError) {
      setIsSubmitting(false);
      setErrorMessage("Erro ao validar telefones. Tente novamente.");
      return;
    }

    if (existing && existing.length > 0) {
      setIsSubmitting(false);
      setErrorMessage("Um dos telefones já possui agendamento. Cada casal pode reservar apenas um horário.");
      return;
    }

    const { error } = await client.from("bookings").insert({
      event_date: selectedDate,
      slot_time: selectedSlot,
      person1: formData.person1.trim(),
      person2: formData.person2.trim(),
      phone1,
      phone2: "",
    });

    setIsSubmitting(false);

    if (error) {
      if (error.code === "23505") {
        setErrorMessage("Esse horário acabou de ser reservado por outro casal. Escolha outro horário.");
      } else {
        setErrorMessage("Não foi possível concluir o agendamento. Tente novamente em instantes.");
      }
      return;
    }

    setMessage("Agendamento realizado com sucesso. Que alegria receber vocês!");
    setSelectedSlot(null);
    setFormData(defaultFormState);
    void fetchBookings(selectedDate);
  };

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-1 flex-col px-4 py-8 sm:px-6 lg:px-8 lg:py-12">
      <header className="panel-glow fade-up rounded-3xl border border-white/70 px-6 py-8 text-center sm:px-10">
        <p className="mb-3 inline-flex rounded-full bg-[var(--brand-soft)] px-4 py-1 text-xs font-semibold tracking-[0.2em] text-[var(--brand)] uppercase">
          Agenda Oficial
        </p>
        <h1 className="text-3xl leading-tight text-slate-900 sm:text-4xl lg:text-5xl">
          3° CONVERSA - ENCONTRO DE CASAIS
        </h1>
        <p className="mx-auto mt-4 max-w-2xl text-sm text-slate-600 sm:text-base">
          Escolha a data e reserve um único horário para o casal.
        </p>
      </header>

      <section className="mt-6 grid gap-6 lg:grid-cols-[1.2fr_0.8fr]">
        <article className="panel-glow fade-up stagger-1 rounded-3xl border border-white/70 p-5 sm:p-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-2xl text-slate-900">Selecione a data</h2>
            <span className="rounded-full bg-white px-4 py-2 text-sm font-semibold text-slate-700 shadow-sm">
              Vagas restantes: {remainingSlots}/{totalBookable}
            </span>
          </div>

          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            {DATE_OPTIONS.map((option) => (
              <button
                key={option.value}
                type="button"
                onClick={() => {
                  setIsLoadingSlots(true);
                  setSelectedDate(option.value);
                  setSelectedSlot(null);
                  setMessage(null);
                  setErrorMessage(null);
                }}
                className={`rounded-2xl border px-4 py-3 text-sm font-semibold transition-all duration-300 ${
                  selectedDate === option.value
                    ? "border-[var(--brand)] bg-[var(--brand)] text-white shadow-md"
                    : "border-slate-200 bg-white text-slate-700 hover:-translate-y-0.5 hover:border-[var(--brand)] hover:text-[var(--brand)]"
                }`}
              >
                {option.label}
              </button>
            ))}
          </div>

          <div className="mt-6">
            <h3 className="text-lg text-slate-900">Horários disponíveis</h3>
            <p className="mt-1 text-sm text-slate-600 text-center">
              Verde: disponível • Vermelho: indisponível • Cinza: almoço
            </p>

            {isLoadingSlots ? (
              <div className="mt-4 grid grid-cols-3 gap-2 sm:grid-cols-4 md:grid-cols-5">
                {Array.from({ length: 20 }).map((_, idx) => (
                  <div key={idx} className="h-11 animate-pulse rounded-xl bg-slate-200" />
                ))}
              </div>
            ) : (
              <div className="mt-4 grid grid-cols-3 gap-2 sm:grid-cols-4 md:grid-cols-5">
                {slots.map((slot) => {
                  const isReserved = bookings.has(slot.value);
                  const isBlocked = slot.isLunch || isReserved;
                  const isSelected = selectedSlot === slot.value;

                  return (
                    <button
                      key={slot.value}
                      type="button"
                      disabled={isBlocked || !canBook}
                      onClick={() => {
                        setSelectedSlot(slot.value);
                        setMessage(null);
                        setErrorMessage(null);
                      }}
                      className={`h-11 rounded-xl border text-sm font-semibold transition-all duration-200 ${
                        slot.isLunch
                          ? "cursor-not-allowed border-slate-300 bg-[var(--muted)]/45 text-slate-600"
                          : isReserved
                            ? "cursor-not-allowed border-red-300 bg-[var(--danger)]/20 text-red-700"
                            : isSelected
                              ? "border-[var(--brand)] bg-[var(--brand)] text-white shadow-md"
                              : "border-green-300 bg-[var(--ok)]/15 text-green-800 hover:-translate-y-0.5 hover:bg-[var(--ok)]/25"
                      }`}
                    >
                      {slot.label}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </article>

        <aside className="panel-glow fade-up stagger-2 rounded-3xl border border-white/70 p-5 sm:p-6">
          <h2 className="text-2xl text-slate-900">Formulário do casal</h2>
          <p className="mt-1 text-sm text-slate-600">
            {selectedSlot
              ? `Horário selecionado: ${selectedSlot.slice(0, 5)} (${formatDateToBrShort(selectedDate)})`
              : "Escolha um horário verde para abrir o agendamento."}
          </p>

          {!canBook && (
            <div className="mt-4 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
              Configure NEXT_PUBLIC_SUPABASE_URL e NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY para ativar reservas em tempo real.
            </div>
          )}

          <form onSubmit={handleSubmit} className="mt-4 space-y-3">
            <input
              type="text"
              placeholder="Nome da Pessoa 1"
              value={formData.person1}
              disabled={!selectedSlot || !canBook}
              onChange={(event) =>
                setFormData((prev) => ({ ...prev, person1: event.target.value }))
              }
              className="w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm outline-none transition focus:border-[var(--brand)] disabled:cursor-not-allowed disabled:bg-slate-100"
              required
            />

            <input
              type="text"
              placeholder="Nome da Pessoa 2"
              value={formData.person2}
              disabled={!selectedSlot || !canBook}
              onChange={(event) =>
                setFormData((prev) => ({ ...prev, person2: event.target.value }))
              }
              className="w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm outline-none transition focus:border-[var(--brand)] disabled:cursor-not-allowed disabled:bg-slate-100"
              required
            />

            <div className="flex gap-2">
              <input
                type="text"
                inputMode="numeric"
                pattern="\d{2}"
                maxLength={2}
                placeholder="DDD"
                value={formData.ddd1}
                disabled={!selectedSlot || !canBook}
                onChange={(event) => {
                  const val = event.target.value.replace(/\D/g, "").slice(0, 2);
                  setFormData((prev) => ({ ...prev, ddd1: val }));
                }}
                className="w-16 rounded-xl border border-slate-300 bg-white px-3 py-3 text-sm outline-none transition focus:border-[var(--brand)] disabled:cursor-not-allowed disabled:bg-slate-100"
                required
              />
              <input
                type="text"
                inputMode="numeric"
                pattern="\d{8,9}"
                maxLength={9}
                placeholder="Telefone para contato"
                value={formData.number1}
                disabled={!selectedSlot || !canBook}
                onChange={(event) => {
                  const val = event.target.value.replace(/\D/g, "").slice(0, 9);
                  setFormData((prev) => ({ ...prev, number1: val }));
                }}
                className="flex-1 rounded-xl border border-slate-300 bg-white px-3 py-3 text-sm outline-none transition focus:border-[var(--brand)] disabled:cursor-not-allowed disabled:bg-slate-100"
                required
              />
            </div>

            <button
              type="submit"
              disabled={!selectedSlot || isSubmitting || !canBook}
              className="flex w-full items-center justify-center rounded-xl bg-[var(--brand)] px-4 py-3 text-sm font-semibold text-white transition hover:brightness-105 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isSubmitting ? (
                <span className="inline-flex items-center gap-2">
                  <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white" />
                  Salvando...
                </span>
              ) : (
                "Confirmar agendamento"
              )}
            </button>
          </form>

          <div className="mt-6 border-t border-slate-200 pt-5">
            <h3 className="text-lg font-semibold text-slate-900">Cancelar agendamento</h3>
            <p className="mt-1 text-sm text-slate-600">
              Informe o telefone usado no agendamento para localizar e cancelar.
            </p>

            <form onSubmit={handleSearchCancel} className="mt-3 space-y-3">
              <div className="flex gap-2">
                <input
                  type="text"
                  inputMode="numeric"
                  pattern="\d{2}"
                  maxLength={2}
                  placeholder="DDD"
                  value={cancelDdd}
                  disabled={!canBook || isSearchingCancel}
                  onChange={(event) => setCancelDdd(event.target.value.replace(/\D/g, "").slice(0, 2))}
                  className="w-16 rounded-xl border border-slate-300 bg-white px-3 py-3 text-sm outline-none transition focus:border-[var(--brand)] disabled:cursor-not-allowed disabled:bg-slate-100"
                  required
                />
                <input
                  type="text"
                  inputMode="numeric"
                  pattern="\d{8,9}"
                  maxLength={9}
                  placeholder="Telefone para cancelar"
                  value={cancelNumber}
                  disabled={!canBook || isSearchingCancel}
                  onChange={(event) => setCancelNumber(event.target.value.replace(/\D/g, "").slice(0, 9))}
                  className="flex-1 rounded-xl border border-slate-300 bg-white px-3 py-3 text-sm outline-none transition focus:border-[var(--brand)] disabled:cursor-not-allowed disabled:bg-slate-100"
                  required
                />
              </div>

              <button
                type="submit"
                disabled={!canBook || isSearchingCancel}
                className="w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {isSearchingCancel ? "Buscando..." : "Buscar meu agendamento"}
              </button>
            </form>

            {cancelFeedback && (
              <p className="mt-3 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700">
                {cancelFeedback}
              </p>
            )}

            {cancelBookings.length > 0 && (
              <div className="mt-3 space-y-2">
                {cancelBookings.map((booking) => (
                  <div
                    key={booking.id}
                    className="flex items-center justify-between gap-2 rounded-xl border border-slate-200 bg-white px-3 py-3"
                  >
                    <div>
                      <p className="text-sm font-semibold text-slate-900">
                        {booking.person1} e {booking.person2}
                      </p>
                      <p className="text-xs text-slate-600">
                        {formatDateToBrShort(booking.event_date)} às {booking.slot_time.slice(0, 5)}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => void handleCancelBooking(booking.id)}
                      disabled={cancelingId === booking.id}
                      className="rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-xs font-semibold text-red-700 transition hover:bg-red-100 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {cancelingId === booking.id ? "Cancelando..." : "Cancelar"}
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

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
        </aside>
      </section>
    </div>
  );
}
