import { BpmFlow } from './bpm.model';
export interface FlowPilotProject {
  id:string; title:string; standard:boolean; linked:boolean; nextClosing:string|null;
  incomeCents:number; expenseCents:number; expectedIncomeCents:number; expectedExpenseCents:number;
}
export interface FlowPilot {
  projectionDate?:string;
  periodWealth?: {historicalFlowCents:number;previousClosureCents:number;currentClosureCents:number;cumulativeFlowCents:number;totalCents:number|null};
  start:string; end:string; projects:FlowPilotProject[];
  incomeCents:number; expenseCents:number; expectedIncomeCents:number; expectedExpenseCents:number;
  netCents:number; expectedNetCents:number; stockCents:number|null; targetCents:number|null;
  phase:string; closingCount:number; nextContributionCents:number|null; projectedStockCents:number|null;
}
export interface FlowDefinition extends BpmFlow {
  id:string; coreTaskId:string; centerName:string; endDate:string; note:string; incomeType:string;
  settledCount:number; decision:string; updatedAt:string;
}
export interface FlowEditorProject {id:string;title:string;standard:boolean;tasks:{id:string;title:string}[];operations:FlowDefinition[];}
