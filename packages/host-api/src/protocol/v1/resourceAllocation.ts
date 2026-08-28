import { Enum, ErrEnum } from '@novasamatech/scale';
import { Vector, _void } from 'scale-ts';

import { CallResult } from '../callError.js';
import { GenericErr } from '../commonCodecs.js';

import { DerivationIndex } from './accounts.js';

// resources requested by a product

export const AllocatableResource = Enum({
  StatementStoreAllowance: _void,
  BulletinAllowance: _void,
  // Account the allowance is granted for, addressed by the RFC-0022 selector.
  SmartContractAllowance: DerivationIndex,
  AutoSigning: _void,
});

// outcome of a single resource allocation, surfaced to the product

export const AllocationOutcome = Enum({
  Allocated: _void,
  Rejected: _void,
  NotAvailable: _void,
});

// errors

export const ResourceAllocationErr = ErrEnum('ResourceAllocationErr', {
  Unknown: [GenericErr, 'ResourceAllocation: unknown error'],
});

// host_request_resource_allocation

export const RequestResourceAllocationV1_request = Vector(AllocatableResource);
export const RequestResourceAllocationV1_response = CallResult(Vector(AllocationOutcome), ResourceAllocationErr);
