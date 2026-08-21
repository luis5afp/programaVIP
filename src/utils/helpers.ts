import { Client } from '../types';

export const calculateDaysRemaining = (endDateStr: string): number => {
  const end = new Date(endDateStr + 'T23:59:59');
  const now = new Date();
  return Math.ceil((end.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
};

export interface SubscriptionState {
  label: string;
  cls: 'ok' | 'warn' | 'bad';
  days: number;
}

export const getSubscriptionState = (client: Client): SubscriptionState => {
  if (client.status !== 'active') {
    return { label: 'Suspendido', cls: 'bad', days: 0 };
  }
  const days = calculateDaysRemaining(client.subscription.end);
  if (days < 0) {
    return { label: 'Vencida', cls: 'bad', days };
  }
  if (days <= 30) {
    return { label: 'Por vencer', cls: 'warn', days };
  }
  return { label: 'Activa', cls: 'ok', days };
};

export const formatDate = (isoString?: string | null): string => {
  if (!isoString) return 'Sin revisar';
  try {
    return new Date(isoString).toLocaleString('es-ES', {
      dateStyle: 'short',
      timeStyle: 'short',
    });
  } catch {
    return isoString;
  }
};
