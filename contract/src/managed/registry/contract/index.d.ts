import type * as __compactRuntime from '@midnight-ntwrk/compact-runtime';

export type Attestation = { tag: Uint8Array;
                            invoiceCommit: Uint8Array;
                            amount: bigint;
                            acceptanceDay: bigint;
                            expiresAt: bigint;
                            borrower: Uint8Array;
                            signature: Schnorr_SchnorrSignature
                          };

export type DrawRecord = { round: Uint8Array; floor: bigint };

export type PoolItem = { tag: Uint8Array;
                         invoiceCommit: Uint8Array;
                         amount: bigint;
                         salt: Uint8Array
                       };

export type AttestationBody = { domain: Uint8Array;
                                registry: Uint8Array;
                                tag: Uint8Array;
                                invoiceCommit: Uint8Array;
                                amount: bigint;
                                acceptanceDay: bigint;
                                expiresAt: bigint;
                                borrower: Uint8Array
                              };

export type Schnorr_SchnorrSignature = { announcement: __compactRuntime.JubjubPoint;
                                         response: bigint
                                       };

export type Witnesses<PS> = {
  getSchnorrReduction(context: __compactRuntime.WitnessContext<Ledger, PS>,
                      challengeHash_0: bigint): [PS, [bigint, bigint]];
  localSecretKey(context: __compactRuntime.WitnessContext<Ledger, PS>): [PS, Uint8Array];
  getAttestation(context: __compactRuntime.WitnessContext<Ledger, PS>): [PS, Attestation];
  getLenderPath(context: __compactRuntime.WitnessContext<Ledger, PS>): [PS, { leaf: Uint8Array,
                                                                              path: { sibling: { field: bigint
                                                                                               },
                                                                                      goes_left: boolean
                                                                                    }[]
                                                                            }];
  getRegistrarPath(context: __compactRuntime.WitnessContext<Ledger, PS>): [PS, { leaf: Uint8Array,
                                                                                 path: { sibling: { field: bigint
                                                                                                  },
                                                                                         goes_left: boolean
                                                                                       }[]
                                                                               }];
  getNoteSalt(context: __compactRuntime.WitnessContext<Ledger, PS>): [PS, Uint8Array];
  getNoteOpening(context: __compactRuntime.WitnessContext<Ledger, PS>): [PS, [Uint8Array,
                                                                              Uint8Array,
                                                                              bigint,
                                                                              Uint8Array]];
  getNotePath(context: __compactRuntime.WitnessContext<Ledger, PS>): [PS, { leaf: Uint8Array,
                                                                            path: { sibling: { field: bigint
                                                                                             },
                                                                                    goes_left: boolean
                                                                                  }[]
                                                                          }];
  getPool(context: __compactRuntime.WitnessContext<Ledger, PS>): [PS, PoolItem[]];
  getPoolPaths(context: __compactRuntime.WitnessContext<Ledger, PS>): [PS, { leaf: Uint8Array,
                                                                             path: { sibling: { field: bigint
                                                                                              },
                                                                                     goes_left: boolean
                                                                                   }[]
                                                                           }[]];
}

export type ImpureCircuits<PS> = {
  approveAdmit(context: __compactRuntime.CircuitContext<PS>,
               lender_0: Uint8Array,
               encryptionKey_0: Uint8Array): __compactRuntime.CircuitResults<PS, []>;
  executeAdmit(context: __compactRuntime.CircuitContext<PS>,
               lender_0: Uint8Array,
               encryptionKey_0: Uint8Array): __compactRuntime.CircuitResults<PS, []>;
  approveRotate(context: __compactRuntime.CircuitContext<PS>,
                members_0: Uint8Array[]): __compactRuntime.CircuitResults<PS, []>;
  executeRotate(context: __compactRuntime.CircuitContext<PS>,
                members_0: Uint8Array[]): __compactRuntime.CircuitResults<PS, []>;
  pledge(context: __compactRuntime.CircuitContext<PS>,
         lender_0: Uint8Array,
         delivery_0: Uint8Array): __compactRuntime.CircuitResults<PS, Uint8Array>;
  release(context: __compactRuntime.CircuitContext<PS>): __compactRuntime.CircuitResults<PS, []>;
  acceptPledge(context: __compactRuntime.CircuitContext<PS>): __compactRuntime.CircuitResults<PS, []>;
  declinePledge(context: __compactRuntime.CircuitContext<PS>): __compactRuntime.CircuitResults<PS, []>;
  proveBorrowingBase(context: __compactRuntime.CircuitContext<PS>,
                     round_0: Uint8Array,
                     floor_0: bigint): __compactRuntime.CircuitResults<PS, []>;
}

export type ProvableCircuits<PS> = {
  approveAdmit(context: __compactRuntime.CircuitContext<PS>,
               lender_0: Uint8Array,
               encryptionKey_0: Uint8Array): __compactRuntime.CircuitResults<PS, []>;
  executeAdmit(context: __compactRuntime.CircuitContext<PS>,
               lender_0: Uint8Array,
               encryptionKey_0: Uint8Array): __compactRuntime.CircuitResults<PS, []>;
  approveRotate(context: __compactRuntime.CircuitContext<PS>,
                members_0: Uint8Array[]): __compactRuntime.CircuitResults<PS, []>;
  executeRotate(context: __compactRuntime.CircuitContext<PS>,
                members_0: Uint8Array[]): __compactRuntime.CircuitResults<PS, []>;
  pledge(context: __compactRuntime.CircuitContext<PS>,
         lender_0: Uint8Array,
         delivery_0: Uint8Array): __compactRuntime.CircuitResults<PS, Uint8Array>;
  release(context: __compactRuntime.CircuitContext<PS>): __compactRuntime.CircuitResults<PS, []>;
  acceptPledge(context: __compactRuntime.CircuitContext<PS>): __compactRuntime.CircuitResults<PS, []>;
  declinePledge(context: __compactRuntime.CircuitContext<PS>): __compactRuntime.CircuitResults<PS, []>;
  proveBorrowingBase(context: __compactRuntime.CircuitContext<PS>,
                     round_0: Uint8Array,
                     floor_0: bigint): __compactRuntime.CircuitResults<PS, []>;
}

export type PureCircuits = {
  registrarKey(sk_0: Uint8Array): Uint8Array;
  committeeLeaf(epoch_0: bigint, member_0: Uint8Array): Uint8Array;
  admitAction(epoch_0: bigint, lender_0: Uint8Array, encryptionKey_0: Uint8Array): Uint8Array;
  rotateAction(epoch_0: bigint,
               member0_0: Uint8Array,
               member1_0: Uint8Array,
               member2_0: Uint8Array): Uint8Array;
  approvalNullifier(action_0: Uint8Array, registrarSecret_0: Uint8Array): Uint8Array;
  borrowerKey(sk_0: Uint8Array): Uint8Array;
  lenderKey(sk_0: Uint8Array): Uint8Array;
  noteCommitment(tag_0: Uint8Array,
                 lender_0: Uint8Array,
                 invoiceCommit_0: Uint8Array,
                 amount_0: bigint,
                 salt_0: Uint8Array): Uint8Array;
  decisionNullifier(note_0: Uint8Array, lenderSecret_0: Uint8Array): Uint8Array;
  releaseNullifier(note_0: Uint8Array, lenderSecret_0: Uint8Array): Uint8Array;
  drawId(round_0: Uint8Array, lenderSecret_0: Uint8Array): Uint8Array;
  attestationMessage(registry_0: Uint8Array,
                     tag_0: Uint8Array,
                     invoiceCommit_0: Uint8Array,
                     amount_0: bigint,
                     acceptanceDay_0: bigint,
                     expiresAt_0: bigint,
                     borrower_0: Uint8Array): bigint[];
  schnorrChallenge(ann_x_0: bigint,
                   ann_y_0: bigint,
                   pk_x_0: bigint,
                   pk_y_0: bigint,
                   msg_0: bigint[]): bigint;
}

export type Circuits<PS> = {
  registrarKey(context: __compactRuntime.CircuitContext<PS>, sk_0: Uint8Array): __compactRuntime.CircuitResults<PS, Uint8Array>;
  committeeLeaf(context: __compactRuntime.CircuitContext<PS>,
                epoch_0: bigint,
                member_0: Uint8Array): __compactRuntime.CircuitResults<PS, Uint8Array>;
  admitAction(context: __compactRuntime.CircuitContext<PS>,
              epoch_0: bigint,
              lender_0: Uint8Array,
              encryptionKey_0: Uint8Array): __compactRuntime.CircuitResults<PS, Uint8Array>;
  rotateAction(context: __compactRuntime.CircuitContext<PS>,
               epoch_0: bigint,
               member0_0: Uint8Array,
               member1_0: Uint8Array,
               member2_0: Uint8Array): __compactRuntime.CircuitResults<PS, Uint8Array>;
  approvalNullifier(context: __compactRuntime.CircuitContext<PS>,
                    action_0: Uint8Array,
                    registrarSecret_0: Uint8Array): __compactRuntime.CircuitResults<PS, Uint8Array>;
  borrowerKey(context: __compactRuntime.CircuitContext<PS>, sk_0: Uint8Array): __compactRuntime.CircuitResults<PS, Uint8Array>;
  lenderKey(context: __compactRuntime.CircuitContext<PS>, sk_0: Uint8Array): __compactRuntime.CircuitResults<PS, Uint8Array>;
  noteCommitment(context: __compactRuntime.CircuitContext<PS>,
                 tag_0: Uint8Array,
                 lender_0: Uint8Array,
                 invoiceCommit_0: Uint8Array,
                 amount_0: bigint,
                 salt_0: Uint8Array): __compactRuntime.CircuitResults<PS, Uint8Array>;
  decisionNullifier(context: __compactRuntime.CircuitContext<PS>,
                    note_0: Uint8Array,
                    lenderSecret_0: Uint8Array): __compactRuntime.CircuitResults<PS, Uint8Array>;
  releaseNullifier(context: __compactRuntime.CircuitContext<PS>,
                   note_0: Uint8Array,
                   lenderSecret_0: Uint8Array): __compactRuntime.CircuitResults<PS, Uint8Array>;
  drawId(context: __compactRuntime.CircuitContext<PS>,
         round_0: Uint8Array,
         lenderSecret_0: Uint8Array): __compactRuntime.CircuitResults<PS, Uint8Array>;
  attestationMessage(context: __compactRuntime.CircuitContext<PS>,
                     registry_0: Uint8Array,
                     tag_0: Uint8Array,
                     invoiceCommit_0: Uint8Array,
                     amount_0: bigint,
                     acceptanceDay_0: bigint,
                     expiresAt_0: bigint,
                     borrower_0: Uint8Array): __compactRuntime.CircuitResults<PS, bigint[]>;
  schnorrChallenge(context: __compactRuntime.CircuitContext<PS>,
                   ann_x_0: bigint,
                   ann_y_0: bigint,
                   pk_x_0: bigint,
                   pk_y_0: bigint,
                   msg_0: bigint[]): __compactRuntime.CircuitResults<PS, bigint>;
  approveAdmit(context: __compactRuntime.CircuitContext<PS>,
               lender_0: Uint8Array,
               encryptionKey_0: Uint8Array): __compactRuntime.CircuitResults<PS, []>;
  executeAdmit(context: __compactRuntime.CircuitContext<PS>,
               lender_0: Uint8Array,
               encryptionKey_0: Uint8Array): __compactRuntime.CircuitResults<PS, []>;
  approveRotate(context: __compactRuntime.CircuitContext<PS>,
                members_0: Uint8Array[]): __compactRuntime.CircuitResults<PS, []>;
  executeRotate(context: __compactRuntime.CircuitContext<PS>,
                members_0: Uint8Array[]): __compactRuntime.CircuitResults<PS, []>;
  pledge(context: __compactRuntime.CircuitContext<PS>,
         lender_0: Uint8Array,
         delivery_0: Uint8Array): __compactRuntime.CircuitResults<PS, Uint8Array>;
  release(context: __compactRuntime.CircuitContext<PS>): __compactRuntime.CircuitResults<PS, []>;
  acceptPledge(context: __compactRuntime.CircuitContext<PS>): __compactRuntime.CircuitResults<PS, []>;
  declinePledge(context: __compactRuntime.CircuitContext<PS>): __compactRuntime.CircuitResults<PS, []>;
  proveBorrowingBase(context: __compactRuntime.CircuitContext<PS>,
                     round_0: Uint8Array,
                     floor_0: bigint): __compactRuntime.CircuitResults<PS, []>;
}

export type Ledger = {
  registrars: {
    isFull(): boolean;
    checkRoot(rt_0: { field: bigint }): boolean;
    root(): __compactRuntime.MerkleTreeDigest;
    firstFree(): bigint;
    pathForLeaf(index_0: bigint, leaf_0: Uint8Array): __compactRuntime.MerkleTreePath<Uint8Array>;
    findPathForLeaf(leaf_0: Uint8Array): __compactRuntime.MerkleTreePath<Uint8Array> | undefined;
    history(): Iterator<__compactRuntime.MerkleTreeDigest>
  };
  readonly committeeEpoch: bigint;
  readonly threshold: bigint;
  proposals: {
    isEmpty(): boolean;
    size(): bigint;
    member(key_0: Uint8Array): boolean;
    lookup(key_0: Uint8Array): {
      isEmpty(): boolean;
      size(): bigint;
      member(elem_0: Uint8Array): boolean;
      [Symbol.iterator](): Iterator<Uint8Array>
    }
  };
  executed: {
    isEmpty(): boolean;
    size(): bigint;
    member(elem_0: Uint8Array): boolean;
    [Symbol.iterator](): Iterator<Uint8Array>
  };
  readonly tagAuthority: __compactRuntime.JubjubPoint;
  readonly windowStart: bigint;
  readonly windowEnd: bigint;
  lenders: {
    isFull(): boolean;
    checkRoot(rt_0: { field: bigint }): boolean;
    root(): __compactRuntime.MerkleTreeDigest;
    firstFree(): bigint;
    pathForLeaf(index_0: bigint, leaf_0: Uint8Array): __compactRuntime.MerkleTreePath<Uint8Array>;
    findPathForLeaf(leaf_0: Uint8Array): __compactRuntime.MerkleTreePath<Uint8Array> | undefined;
    history(): Iterator<__compactRuntime.MerkleTreeDigest>
  };
  lenderEncryptionKeys: {
    isEmpty(): boolean;
    size(): bigint;
    member(key_0: Uint8Array): boolean;
    lookup(key_0: Uint8Array): Uint8Array;
    [Symbol.iterator](): Iterator<[Uint8Array, Uint8Array]>
  };
  deliveries: {
    isEmpty(): boolean;
    size(): bigint;
    member(key_0: Uint8Array): boolean;
    lookup(key_0: Uint8Array): Uint8Array;
    [Symbol.iterator](): Iterator<[Uint8Array, Uint8Array]>
  };
  tags: {
    isEmpty(): boolean;
    size(): bigint;
    member(elem_0: Uint8Array): boolean;
    [Symbol.iterator](): Iterator<Uint8Array>
  };
  notes: {
    isFull(): boolean;
    checkRoot(rt_0: { field: bigint }): boolean;
    root(): __compactRuntime.MerkleTreeDigest;
    firstFree(): bigint;
    pathForLeaf(index_0: bigint, leaf_0: Uint8Array): __compactRuntime.MerkleTreePath<Uint8Array>;
    findPathForLeaf(leaf_0: Uint8Array): __compactRuntime.MerkleTreePath<Uint8Array> | undefined;
    history(): Iterator<__compactRuntime.MerkleTreeDigest>
  };
  releases: {
    isEmpty(): boolean;
    size(): bigint;
    member(elem_0: Uint8Array): boolean;
    [Symbol.iterator](): Iterator<Uint8Array>
  };
  accepted: {
    isEmpty(): boolean;
    size(): bigint;
    member(elem_0: Uint8Array): boolean;
    [Symbol.iterator](): Iterator<Uint8Array>
  };
  declined: {
    isEmpty(): boolean;
    size(): bigint;
    member(elem_0: Uint8Array): boolean;
    [Symbol.iterator](): Iterator<Uint8Array>
  };
  draws: {
    isEmpty(): boolean;
    size(): bigint;
    member(key_0: Uint8Array): boolean;
    lookup(key_0: Uint8Array): DrawRecord;
    [Symbol.iterator](): Iterator<[Uint8Array, DrawRecord]>
  };
  readonly pledgeCount: bigint;
  readonly releaseCount: bigint;
  readonly acceptCount: bigint;
  readonly declineCount: bigint;
  readonly drawCount: bigint;
}

export type ContractReferenceLocations = any;

export declare const contractReferenceLocations : ContractReferenceLocations;

export declare class Contract<PS = any, W extends Witnesses<PS> = Witnesses<PS>> {
  witnesses: W;
  circuits: Circuits<PS>;
  impureCircuits: ImpureCircuits<PS>;
  provableCircuits: ProvableCircuits<PS>;
  constructor(witnesses: W);
  initialState(context: __compactRuntime.ConstructorContext<PS>,
               authority_0: __compactRuntime.JubjubPoint,
               start_0: bigint,
               end_0: bigint,
               committee_0: Uint8Array[]): __compactRuntime.ConstructorResult<PS>;
}

export declare function ledger(state: __compactRuntime.StateValue | __compactRuntime.ChargedState): Ledger;
export declare const pureCircuits: PureCircuits;
