import { EventFilter, Event } from "ethers";
import { Result } from "@ethersproject/abi";
export interface TypedEventFilter<_EventArgsArray, _EventArgsObject> extends EventFilter {
}
export interface TypedEvent<EventArgs extends Result> extends Event {
    args: EventArgs;
}
export declare type TypedListener<EventArgsArray extends Array<any>, EventArgsObject> = (...listenerArg: [
    ...EventArgsArray,
    TypedEvent<EventArgsArray & EventArgsObject>
]) => void;
