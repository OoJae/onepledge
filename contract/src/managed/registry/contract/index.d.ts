import type * as __compactRuntime from '@midnight-ntwrk/compact-runtime';

export type Attestation = { tag: Uint8Array;
                            invoiceCommit: Uint8Array;
                            acceptanceDay: bigint;
                            borrower: Uint8Array;
                            signature: Schnorr_SchnorrSignature
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
  getNoteSalt(context: __compactRuntime.WitnessContext<Ledger, PS>): [PS, Uint8Array];
  getNoteOpening(context: __compactRuntime.WitnessContext<Ledger, PS>): [PS, [Uint8Array,
                                                                              Uint8Array,
                                                                              Uint8Array]];
  getNotePath(context: __compactRuntime.WitnessContext<Ledger, PS>): [PS, { leaf: Uint8Array,
                                                                            path: { sibling: { field: bigint
                                                                                             },
                                                                                    goes_left: boolean
                                                                                  }[]
                                                                          }];
}

export type ImpureCircuits<PS> = {
  admitLender(context: __compactRuntime.CircuitContext<PS>, lender_0: Uint8Array): __compactRuntime.CircuitResults<PS, []>;
  rotateRegistrar(context: __compactRuntime.CircuitContext<PS>,
                  next_0: Uint8Array): __compactRuntime.CircuitResults<PS, []>;
  pledge(context: __compactRuntime.CircuitContext<PS>, lender_0: Uint8Array): __compactRuntime.CircuitResults<PS, Uint8Array>;
  release(context: __compactRuntime.CircuitContext<PS>): __compactRuntime.CircuitResults<PS, []>;
}

export type ProvableCircuits<PS> = {
  admitLender(context: __compactRuntime.CircuitContext<PS>, lender_0: Uint8Array): __compactRuntime.CircuitResults<PS, []>;
  rotateRegistrar(context: __compactRuntime.CircuitContext<PS>,
                  next_0: Uint8Array): __compactRuntime.CircuitResults<PS, []>;
  pledge(context: __compactRuntime.CircuitContext<PS>, lender_0: Uint8Array): __compactRuntime.CircuitResults<PS, Uint8Array>;
  release(context: __compactRuntime.CircuitContext<PS>): __compactRuntime.CircuitResults<PS, []>;
}

export type PureCircuits = {
  attestationDomain(): bigint;
  registrarKey(sk_0: Uint8Array): Uint8Array;
  borrowerKey(sk_0: Uint8Array): Uint8Array;
  lenderKey(sk_0: Uint8Array): Uint8Array;
  noteCommitment(tag_0: Uint8Array,
                 lender_0: Uint8Array,
                 invoiceCommit_0: Uint8Array,
                 salt_0: Uint8Array): Uint8Array;
  releaseNullifier(note_0: Uint8Array, lenderSecret_0: Uint8Array): Uint8Array;
  attestationMessage(tag_0: Uint8Array,
                     invoiceCommit_0: Uint8Array,
                     acceptanceDay_0: bigint,
                     borrower_0: Uint8Array): bigint[];
  schnorrChallenge(ann_x_0: bigint,
                   ann_y_0: bigint,
                   pk_x_0: bigint,
                   pk_y_0: bigint,
                   msg_0: bigint[]): bigint;
}

export type Circuits<PS> = {
  attestationDomain(context: __compactRuntime.CircuitContext<PS>): __compactRuntime.CircuitResults<PS, bigint>;
  registrarKey(context: __compactRuntime.CircuitContext<PS>, sk_0: Uint8Array): __compactRuntime.CircuitResults<PS, Uint8Array>;
  borrowerKey(context: __compactRuntime.CircuitContext<PS>, sk_0: Uint8Array): __compactRuntime.CircuitResults<PS, Uint8Array>;
  lenderKey(context: __compactRuntime.CircuitContext<PS>, sk_0: Uint8Array): __compactRuntime.CircuitResults<PS, Uint8Array>;
  noteCommitment(context: __compactRuntime.CircuitContext<PS>,
                 tag_0: Uint8Array,
                 lender_0: Uint8Array,
                 invoiceCommit_0: Uint8Array,
                 salt_0: Uint8Array): __compactRuntime.CircuitResults<PS, Uint8Array>;
  releaseNullifier(context: __compactRuntime.CircuitContext<PS>,
                   note_0: Uint8Array,
                   lenderSecret_0: Uint8Array): __compactRuntime.CircuitResults<PS, Uint8Array>;
  attestationMessage(context: __compactRuntime.CircuitContext<PS>,
                     tag_0: Uint8Array,
                     invoiceCommit_0: Uint8Array,
                     acceptanceDay_0: bigint,
                     borrower_0: Uint8Array): __compactRuntime.CircuitResults<PS, bigint[]>;
  schnorrChallenge(context: __compactRuntime.CircuitContext<PS>,
                   ann_x_0: bigint,
                   ann_y_0: bigint,
                   pk_x_0: bigint,
                   pk_y_0: bigint,
                   msg_0: bigint[]): __compactRuntime.CircuitResults<PS, bigint>;
  admitLender(context: __compactRuntime.CircuitContext<PS>, lender_0: Uint8Array): __compactRuntime.CircuitResults<PS, []>;
  rotateRegistrar(context: __compactRuntime.CircuitContext<PS>,
                  next_0: Uint8Array): __compactRuntime.CircuitResults<PS, []>;
  pledge(context: __compactRuntime.CircuitContext<PS>, lender_0: Uint8Array): __compactRuntime.CircuitResults<PS, Uint8Array>;
  release(context: __compactRuntime.CircuitContext<PS>): __compactRuntime.CircuitResults<PS, []>;
}

export type Ledger = {
  readonly registrar: Uint8Array;
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
  readonly pledgeCount: bigint;
  readonly releaseCount: bigint;
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
               end_0: bigint): __compactRuntime.ConstructorResult<PS>;
}

export declare function ledger(state: __compactRuntime.StateValue | __compactRuntime.ChargedState): Ledger;
export declare const pureCircuits: PureCircuits;
