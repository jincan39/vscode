/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
'use strict';

import { TPromise } from 'vs/base/common/winjs.base';
import { wireCancellationToken, asWinJsPromise } from 'vs/base/common/async';
import { CancellationToken } from 'vs/base/common/cancellation';
import { QuickPickOptions, QuickPickItem, InputBoxOptions, WorkspaceFolderPickOptions, WorkspaceFolder, QuickInput, QuickPick, InputBox, QuickInputCommand } from 'vscode';
import { MainContext, MainThreadQuickOpenShape, ExtHostQuickOpenShape, MyQuickPickItems, IMainContext, TransferQuickInput } from './extHost.protocol';
import { ExtHostWorkspace } from 'vs/workbench/api/node/extHostWorkspace';
import { ExtHostCommands } from 'vs/workbench/api/node/extHostCommands';
import { Emitter } from 'vs/base/common/event';
import { assign } from 'vs/base/common/objects';

export type Item = string | QuickPickItem;

export class ExtHostQuickOpen implements ExtHostQuickOpenShape {

	private _proxy: MainThreadQuickOpenShape;
	private _workspace: ExtHostWorkspace;
	private _commands: ExtHostCommands;

	private _onDidSelectItem: (handle: number) => void;
	private _validateInput: (input: string) => string | Thenable<string>;

	private _sessions = new Map<number, ExtHostQuickInput>();

	constructor(mainContext: IMainContext, workspace: ExtHostWorkspace, commands: ExtHostCommands) {
		this._proxy = mainContext.getProxy(MainContext.MainThreadQuickOpen);
		this._workspace = workspace;
		this._commands = commands;
	}

	showQuickPick(itemsOrItemsPromise: QuickPickItem[] | Thenable<QuickPickItem[]>, options: QuickPickOptions & { canPickMany: true; }, token?: CancellationToken): Thenable<QuickPickItem[] | undefined>;
	showQuickPick(itemsOrItemsPromise: string[] | Thenable<string[]>, options?: QuickPickOptions, token?: CancellationToken): Thenable<string | undefined>;
	showQuickPick(itemsOrItemsPromise: QuickPickItem[] | Thenable<QuickPickItem[]>, options?: QuickPickOptions, token?: CancellationToken): Thenable<QuickPickItem | undefined>;
	showQuickPick(itemsOrItemsPromise: Item[] | Thenable<Item[]>, options?: QuickPickOptions, token: CancellationToken = CancellationToken.None): Thenable<Item | Item[] | undefined> {

		// clear state from last invocation
		this._onDidSelectItem = undefined;

		const itemsPromise = <TPromise<Item[]>>TPromise.wrap(itemsOrItemsPromise);

		const quickPickWidget = this._proxy.$show({
			placeHolder: options && options.placeHolder,
			matchOnDescription: options && options.matchOnDescription,
			matchOnDetail: options && options.matchOnDetail,
			ignoreFocusLost: options && options.ignoreFocusOut,
			canPickMany: options && options.canPickMany
		});

		const promise = TPromise.any(<TPromise<number | Item[]>[]>[quickPickWidget, itemsPromise]).then(values => {
			if (values.key === '0') {
				return undefined;
			}

			return itemsPromise.then(items => {

				let pickItems: MyQuickPickItems[] = [];
				for (let handle = 0; handle < items.length; handle++) {

					let item = items[handle];
					let label: string;
					let description: string;
					let detail: string;
					let picked: boolean;

					if (typeof item === 'string') {
						label = item;
					} else {
						label = item.label;
						description = item.description;
						detail = item.detail;
						picked = item.picked;
					}
					pickItems.push({
						label,
						description,
						handle,
						detail,
						picked
					});
				}

				// handle selection changes
				if (options && typeof options.onDidSelectItem === 'function') {
					this._onDidSelectItem = (handle) => {
						options.onDidSelectItem(items[handle]);
					};
				}

				// show items
				this._proxy.$setItems(pickItems);

				return quickPickWidget.then(handle => {
					if (typeof handle === 'number') {
						return items[handle];
					} else if (Array.isArray(handle)) {
						return handle.map(h => items[h]);
					}
					return undefined;
				});
			}, (err) => {
				this._proxy.$setError(err);

				return TPromise.wrapError(err);
			});
		});
		return wireCancellationToken<Item | Item[]>(token, promise, true);
	}

	$onItemSelected(handle: number): void {
		if (this._onDidSelectItem) {
			this._onDidSelectItem(handle);
		}
	}

	// ---- input

	showInput(options?: InputBoxOptions, token: CancellationToken = CancellationToken.None): Thenable<string> {

		// global validate fn used in callback below
		this._validateInput = options && options.validateInput;

		const promise = this._proxy.$input(options, typeof this._validateInput === 'function');
		return wireCancellationToken(token, promise, true);
	}

	$validateInput(input: string): TPromise<string> {
		if (this._validateInput) {
			return asWinJsPromise(_ => this._validateInput(input));
		}
		return undefined;
	}

	// ---- workspace folder picker

	showWorkspaceFolderPick(options?: WorkspaceFolderPickOptions, token = CancellationToken.None): Thenable<WorkspaceFolder> {
		return this._commands.executeCommand('_workbench.pickWorkspaceFolder', [options]).then((selectedFolder: WorkspaceFolder) => {
			if (!selectedFolder) {
				return undefined;
			}

			return this._workspace.getWorkspaceFolders().filter(folder => folder.uri.toString() === selectedFolder.uri.toString())[0];
		});
	}

	// ---- QuickInput

	createQuickPick(extensionId: string): QuickPick {
		const session = new ExtHostQuickPick(this._proxy, extensionId, () => this._sessions.delete(session._id));
		this._sessions.set(session._id, session);
		return session;
	}

	createInputBox(extensionId: string): InputBox {
		const session = new ExtHostInputBox(this._proxy, extensionId, () => this._sessions.delete(session._id));
		this._sessions.set(session._id, session);
		return session;
	}

	$onDidSelectItems(sessionId: number, handles: number[]): void {
		const session = this._sessions.get(sessionId);
		if (session instanceof ExtHostQuickPick) {
			session._fireDidSelectionChange(handles);
		}
	}
}

class ExtHostQuickInput implements QuickInput {

	private static _nextId = 1;
	_id = ExtHostQuickPick._nextId++;

	private _visible = false;
	private _enabled = true;
	private _busy = false;
	private _onDidHideEmitter = new Emitter<void>();
	private _updateTimeout: number;
	private _pendingUpdate: TransferQuickInput = { id: this._id };
	private _disposed = false;

	constructor(protected _proxy: MainThreadQuickOpenShape, protected _extensionId: string, private _onDispose: () => void) {
	}

	get enabled() {
		return this._enabled;
	}

	set enabled(enabled: boolean) {
		this._enabled = enabled;
		this.update({ enabled });
	}

	get busy() {
		return this._busy;
	}

	set busy(busy: boolean) {
		this._busy = busy;
		this.update({ busy });
	}

	show(): void {
		this._visible = true;
		this.update({ visible: true });
	}

	hide(): void {
		this._visible = false;
		this.update({ visible: false });
	}

	onDidHide = this._onDidHideEmitter.event;

	public dispose(): void {
		if (this._disposed) {
			return;
		}
		this._disposed = true;
		this._onDidHideEmitter.dispose(); // TODO: Also in subclasses.
		clearTimeout(this._updateTimeout);
		this._onDispose();
		this._proxy.$dispose(this._id);
	}

	protected update(properties: Record<string, any>): void {
		if (this._disposed) {
			return;
		}
		assign(this._pendingUpdate, properties);

		if (!this._visible) {
			return;
		}

		// Defer the update so that multiple changes to setters dont cause a redraw each
		clearTimeout(this._updateTimeout);
		this._updateTimeout = setTimeout(() => {
			if (this._disposed) {
				return;
			}
			this._proxy.$createOrUpdate(this._pendingUpdate);
			this._pendingUpdate = { id: this._id };
		}, 0);
	}
}

class ExtHostQuickPick extends ExtHostQuickInput implements QuickPick {

	private _value = '';
	private _placeholder: string;
	private _onDidValueChangeEmitter = new Emitter<string>();
	private _onDidAcceptEmitter = new Emitter<string>();
	private _commands: QuickInputCommand[] = [];
	private _onDidTriggerCommandEmitter = new Emitter<QuickInputCommand>();
	private _items: QuickPickItem[] = [];
	private _handlesToItems = new Map<number, QuickPickItem>();
	private _canSelectMany = false;
	private _builtInFilter = true;
	private _focusedItems: QuickPickItem[] = [];
	private _onDidFocusChangeEmitter = new Emitter<QuickPickItem[]>();
	private _selectedItems: QuickPickItem[] = [];
	private _onDidSelectionChangeEmitter = new Emitter<QuickPickItem[]>();

	constructor(proxy: MainThreadQuickOpenShape, extensionId: string, onDispose: () => void) {
		super(proxy, extensionId, onDispose);
	}

	get value() {
		return this._value;
	}

	set value(value: string) {
		this._value = value;
		this.update({ value });
	}

	get placeholder() {
		return this._placeholder;
	}

	set placeholder(placeholder: string) {
		this._placeholder = placeholder;
		this.update({ placeholder });
	}

	onDidValueChange = this._onDidValueChangeEmitter.event;

	onDidAccept = this._onDidAcceptEmitter.event;

	get commands() {
		return this._commands;
	}

	set commands(commands: QuickInputCommand[]) {
		this._commands = commands;
		this.update({ commands });
	}

	onDidTriggerCommand = this._onDidTriggerCommandEmitter.event;

	get items() {
		return this._items;
	}

	set items(items: QuickPickItem[]) {
		this._items = items;
		this._handlesToItems.clear();
		items.forEach((item, i) => {
			this._handlesToItems.set(i, item);
		});
		this.update({
			items: items.map((item, i) => ({
				label: item.label,
				description: item.description,
				handle: i,
				detail: item.detail,
				picked: item.picked
			}))
		});
	}

	get canSelectMany() {
		return this._canSelectMany;
	}

	set canSelectMany(canSelectMany: boolean) {
		this._canSelectMany = canSelectMany;
		this.update({ canSelectMany });
	}

	get builtInFilter() {
		return this._builtInFilter;
	}

	set builtInFilter(builtInFilter: boolean) {
		this._builtInFilter = builtInFilter;
		this.update({ builtInFilter });
	}

	get focusedItems() {
		return this._focusedItems;
	}

	onDidFocusChange = this._onDidFocusChangeEmitter.event;

	get selectedItems() {
		return this._selectedItems;
	}

	onDidSelectionChange = this._onDidSelectionChangeEmitter.event;

	_fireDidSelectionChange(handles: number[]) {
		const items = handles.map(handle => this._handlesToItems.get(handle));
		this._onDidSelectionChangeEmitter.fire(items);
	}
}

class ExtHostInputBox extends ExtHostQuickInput implements InputBox {

	private _value = '';
	private _placeholder: string;
	private _password: boolean;
	private _prompt: string;
	private _validationMessage: string;
	private _onDidValueChangeEmitter = new Emitter<string>();
	private _onDidAcceptEmitter = new Emitter<string>();
	private _commands: QuickInputCommand[] = [];
	private _onDidTriggerCommandEmitter = new Emitter<QuickInputCommand>();

	constructor(proxy: MainThreadQuickOpenShape, extensionId: string, onDispose: () => void) {
		super(proxy, extensionId, onDispose);
	}

	get value() {
		return this._value;
	}

	set value(value: string) {
		this._value = value;
		this.update({ value });
	}

	get placeholder() {
		return this._placeholder;
	}

	set placeholder(placeholder: string) {
		this._placeholder = placeholder;
		this.update({ placeholder });
	}

	get password() {
		return this._password;
	}

	set password(password: boolean) {
		this._password = password;
		this.update({ password });
	}

	get prompt() {
		return this._prompt;
	}

	set prompt(prompt: string) {
		this._prompt = prompt;
		this.update({ prompt });
	}

	get validationMessage() {
		return this._validationMessage;
	}

	set validationMessage(validationMessage: string) {
		this._validationMessage = validationMessage;
		this.update({ validationMessage });
	}

	onDidValueChange = this._onDidValueChangeEmitter.event;

	onDidAccept = this._onDidAcceptEmitter.event;

	get commands() {
		return this._commands;
	}

	set commands(commands: QuickInputCommand[]) {
		this._commands = commands;
		this.update({ commands });
	}

	onDidTriggerCommand = this._onDidTriggerCommandEmitter.event;
}