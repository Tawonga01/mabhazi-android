import React from 'react';
import {useBlockedContributors} from '@/hooks/useBlockedContributors';
import {JourneySummaryCard} from './JourneySummaryCard';
export interface JourneyStopInfo {
  id: number;
  city: string;
  arrivalTime: string | null;
  departureTime: string | null;
  sequence: number;
}

export interface Journey {
  id: number;
  fromCity: string;
  toCity: string;
  departureTime: string;
  arrivalTime: string;
  scheduledDays: string;
  busCompany: string;
  pickupPoint: string;
  dropoffPoint: string;
  price: number;
  contributorId?: string | null;
  contributorName: string;
  createdAt: string;
  dataStatus?: "active" | "uncertain" | "inactive";
  confidenceScore?: number;
  confirmationCount?: number;
  lastConfirmedAt?: string | null;
  averageRating: number | null;
  ratingCount: number;
  userRating: number | null;
  stops: JourneyStopInfo[];
}

interface JourneyCardProps {
  journey: Journey;
  onRate?: (score: number) => void;
  onPress?: () => void;
}


export function JourneyCard({journey,onPress}:JourneyCardProps){
 const {isBlocked}=useBlockedContributors();
 if(journey.contributorId&&isBlocked(journey.contributorId))return null;
 // Legacy catalogue entries have no individual price/place review binding.
 // Keep those values in the existing details, never imply field approval here.
 return <JourneySummaryCard operator={journey.busCompany} departure={journey.departureTime}
  arrival={journey.arrivalTime||undefined} boarding={journey.fromCity} alighting={journey.toCity} onPress={onPress}
  label={`View route: ${journey.fromCity} to ${journey.toCity}, ${journey.busCompany}`}
  context={`View route: ${journey.fromCity} to ${journey.toCity}, ${journey.busCompany}. Departure ${journey.departureTime}, arrival ${journey.arrivalTime||'unknown'}.`}/>;
}
