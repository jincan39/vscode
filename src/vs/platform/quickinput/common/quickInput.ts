/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
'use strict';

import { createDecorator } from 'vs/platform/instantiation/common/instantiation';
import { TPromise } from 'vs/base/common/winjs.base';
import { CancellationToken } from 'vs/base/common/cancellation';
import { ResolvedKeybinding } from 'vs/base/common/keyCodes';

export interface IPickOpenEntry {
	id?: string;
	label: string;
	description?: string;
	detail?: string;
	picked?: boolean;
}

export interface IQuickNavigateConfiguration {
	keybindings: ResolvedKeybinding[];
}

export interface IPickOptions {

	/**
	 * an optional string to show as place holder in the input box to guide the user what she picks on
	 */
	placeHolder?: string;

	/**
	 * an optional flag to include the description when filtering the picks
	 */
	matchOnDescription?: boolean;

	/**
	 * an optional flag to include the detail when filtering the picks
	 */
	matchOnDetail?: boolean;

	/**
	 * an optional flag to not close the picker on focus lost
	 */
	ignoreFocusLost?: boolean;

	/**
	 * an optional flag to make this picker multi-select
	 */
	canPickMany?: boolean;
}

export interface IInputOptions {

	/**
	 * the value to prefill in the input box
	 */
	value?: string;

	/**
	 * the selection of value, default to the whole word
	 */
	valueSelection?: [number, number];

	/**
	 * the text to display underneath the input box
	 */
	prompt?: string;

	/**
	 * an optional string to show as place holder in the input box to guide the user what to type
	 */
	placeHolder?: string;

	/**
	 * set to true to show a password prompt that will not show the typed value
	 */
	password?: boolean;

	ignoreFocusLost?: boolean;

	/**
	 * an optional function that is used to validate user input.
	 */
	validateInput?: (input: string) => TPromise<string>;
}

export type InputParameters = PickOneParameters | PickManyParameters | TextInputParameters;

export type InputResult<P extends InputParameters> =
	P extends PickOneParameters<infer T> ? T :
	P extends PickManyParameters<infer T> ? T[] :
	P extends TextInputParameters ? string :
	never;

export interface BaseInputParameters {
	readonly type: 'pickOne' | 'pickMany' | 'textInput';
	readonly ignoreFocusLost?: boolean;
}

export interface PickParameters<T extends IPickOpenEntry = IPickOpenEntry> extends BaseInputParameters {
	readonly type: 'pickOne' | 'pickMany';
	readonly picks: TPromise<T[]>;
	readonly matchOnDescription?: boolean;
	readonly matchOnDetail?: boolean;
	readonly placeHolder?: string;
}

export interface PickOneParameters<T extends IPickOpenEntry = IPickOpenEntry> extends PickParameters<T> {
	readonly type: 'pickOne';
}

export interface PickManyParameters<T extends IPickOpenEntry = IPickOpenEntry> extends PickParameters<T> {
	readonly type: 'pickMany';
}

export interface TextInputParameters extends BaseInputParameters {
	readonly type: 'textInput';
	readonly value?: string;
	readonly valueSelection?: [number, number];
	readonly prompt?: string;
	readonly placeHolder?: string;
	readonly password?: boolean;
	readonly validateInput?: (input: string) => TPromise<string>;
}

export const IQuickInputService = createDecorator<IQuickInputService>('quickInputService');

export interface IQuickInputService {

	_serviceBrand: any;

	/**
	 * Opens the quick input box for selecting items and returns a promise with the user selected item(s) if any.
	 */
	pick<T extends IPickOpenEntry, O extends IPickOptions>(picks: TPromise<T[]>, options?: O, token?: CancellationToken): TPromise<O extends { canPickMany: true } ? T[] : T>;

	/**
	 * Opens the quick input box for text input and returns a promise with the user typed value if any.
	 */
	input(options?: IInputOptions, token?: CancellationToken): TPromise<string>;

	show<P extends InputParameters>(parameters: P, token?: CancellationToken): TPromise<InputResult<P>>;

	focus(): void;

	toggle(): void;

	navigate(next: boolean, quickNavigate?: IQuickNavigateConfiguration): void;

	accept(): TPromise<void>;

	cancel(): TPromise<void>;
}
