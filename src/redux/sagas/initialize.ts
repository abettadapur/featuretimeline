import * as VSS_Service from 'VSS/Service';
import {
    all,
    call,
    put
} from 'redux-saga/effects';
import { backlogConfigurationReceived } from '../store/backlogconfiguration/actionCreators';
import { genericError } from '../store/error/actionCreators';
import { WorkItemTrackingHttpClient } from 'TFS/WorkItemTracking/RestClient';
import { WorkHttpClient } from 'TFS/Work/RestClient';
import { InitializeAction } from '../store/common/actions';
import { teamSettingsIterationReceived, changeDisplayIterationCount } from '../store/teamiterations/actionCreators';
import { workItemLinksReceived, workItemsReceived, setOverrideIteration } from '../store/workitems/actionCreators';
import { WorkItemMetadataService } from '../../Services/WorkItemMetadataService';
import { workItemTypesReceived } from '../store/workitemmetadata/actionCreators';
import TFS_Core_Contracts = require('TFS/Core/Contracts');
import Contracts = require('TFS/Work/Contracts');
import WitContracts = require('TFS/WorkItemTracking/Contracts');
import { loading } from '../store/loading/actionCreators';
import { IOverriddenIterationDuration } from '../store';

// For sagas read  https://redux-saga.js.org/docs/introduction/BeginnerTutorial.html
// For details saga effects read https://redux-saga.js.org/docs/basics/DeclarativeEffects.html

// Setup to call initialize saga for every initialize action

export function* callinitialize(action: InitializeAction) {
    yield put(loading(true));
    yield call(handleInitialize, action);
    yield put(loading(false));
}

export function* handleInitialize(action: InitializeAction) {
    const {
        projectId,
        teamId
    } = action.payload;
    const teamContext = {
        teamId,
        projectId
    } as TFS_Core_Contracts.TeamContext;

    const workHttpClient = VSS_Service.getClient(WorkHttpClient);
    const metadatService = WorkItemMetadataService.getInstance();
    const witHttpClient = VSS_Service.getClient(WorkItemTrackingHttpClient);
    const dataService = yield call(VSS.getService, VSS.ServiceIds.ExtensionData);
    if (!workHttpClient.getBacklogConfigurations) {
        yield put(genericError("This extension is supported on Team Foundation Server 2018 or above."));
        return;
    }

    try {
        // Fetch backlog config, team iterations, workItem types and state metadata in parallel
        const [bc, tis, wits, overriddenWorkItemIterations, iterationDisplayOptions, ts, tfv] = yield all([
            call(workHttpClient.getBacklogConfigurations.bind(workHttpClient), teamContext),
            call(workHttpClient.getTeamIterations.bind(workHttpClient), teamContext),
            //call(metadatService.getStates.bind(metadatService), projectId),
            call(metadatService.getWorkItemTypes.bind(metadatService), projectId),
            call(dataService.getValue.bind(dataService), "overriddenWorkItemIterations"),
            call(dataService.getValue.bind(dataService), "iterationDisplayOptions"),
            call(workHttpClient.getTeamSettings.bind(workHttpClient), teamContext),
            call(workHttpClient.getTeamFieldValues.bind(workHttpClient), teamContext)
        ]);

        yield put(backlogConfigurationReceived(projectId, teamId, bc));
        yield put(teamSettingsIterationReceived(projectId, teamId, tis));
        if (iterationDisplayOptions) {
            yield put(changeDisplayIterationCount(iterationDisplayOptions.count, iterationDisplayOptions.projectId, iterationDisplayOptions.teamId));
        }
        yield put(workItemTypesReceived(projectId, wits));
        //yield put(workItemStateColorsReceived(projectId, stateColors));

        const backlogConfig: Contracts.BacklogConfiguration = bc;
        const teamSettings: Contracts.TeamSetting = ts;
        const teamFieldValues: Contracts.TeamFieldValues = tfv;

        // For now show only lowest level of portfolio backlog
        backlogConfig.portfolioBacklogs.sort((b1, b2) => b1.rank - b2.rank);
        const currentBacklogLevel = backlogConfig.portfolioBacklogs[0];
        const workItemTypes = currentBacklogLevel.workItemTypes.map(w => `'${w.name}'`).join(",");
        const stateInfo: Contracts.WorkItemTypeStateInfo[] = backlogConfig.workItemTypeMappedStates.filter(wtms => currentBacklogLevel.workItemTypes.some(wit => wit.name.toLowerCase() === wtms.workItemTypeName.toLowerCase()));
        const orderField = backlogConfig.backlogFields.typeFields["Order"];

        let backlogIteration = teamSettings.backlogIteration.path || teamSettings.backlogIteration.name;
        if (backlogIteration[0] === "\\") {
            const webContext = VSS.getWebContext();
            backlogIteration = webContext.project.name + backlogIteration;
        }
        backlogIteration = _escape(backlogIteration);

        const workItemTypeAndStatesClause =
            stateInfo
                .map(si => {
                    const states = Object.keys(si.states).filter(state => si.states[state] === "InProgress")
                        .map(state => _escape(state))
                        .join("', '");

                    return `(
                             [System.WorkItemType] = '${_escape(si.workItemTypeName)}'
                             AND [System.State] IN ('${states}')
                            )`;

                }).join(" OR ");

        const teamFieldClause = teamFieldValues.values.map((tfValue) => {
            const operator = tfValue.includeChildren ? "UNDER" : "=";
            return `[${_escape(teamFieldValues.field.referenceName)}] ${operator} '${_escape(tfValue.value)}'`;

        }).join(" OR ");

        const wiql = `SELECT   System.Id
                        FROM     WorkItems
                        WHERE    [System.WorkItemType] IN (${workItemTypes})
                        AND      [System.IterationPath] UNDER '${backlogIteration}'
                        AND      (${workItemTypeAndStatesClause})
                        AND      (${teamFieldClause})
                        ORDER BY [${orderField}] ASC,[System.Id] ASC`;

        const queryResults: WitContracts.WorkItemQueryResult = yield call(witHttpClient.queryByWiql.bind(witHttpClient), { query: wiql }, projectId);

        // Get work items for backlog level
        const backlogLevelWorkItemIds: number[] = [];
        let childWorkItemIds: number[] = [];
        let parentWorkItemIds: number[] = [];
        let workItemsToPage: number[] = [];

        // Get child work items and page all work items
        if (queryResults && queryResults.workItems && queryResults.workItems.length > 0) {

            const potentialBacklogLevelWorkItemIds = queryResults.workItems.map(w => w.id);

            let pagedWorkItems = yield call(_pageWorkItemFields, potentialBacklogLevelWorkItemIds, [orderField]);

            pagedWorkItems = pagedWorkItems.filter((wi) => _isInProgress(wi, bc));

            const childBacklogLevel = yield call(_findChildBacklogLevel, currentBacklogLevel, bc);
            const parentBacklogLevel = yield call(_findParentBacklogLevel, currentBacklogLevel, bc);
            backlogLevelWorkItemIds.push(...pagedWorkItems.map((wi) => wi.id));

            const childQueryResult: WitContracts.WorkItemQueryResult = yield call(_runChildWorkItemQuery, backlogLevelWorkItemIds, projectId, childBacklogLevel);
            if (childQueryResult && childQueryResult.workItemRelations) {
                childWorkItemIds = childQueryResult.workItemRelations
                    .filter(link => link.target && link.rel)
                    .map((link) => link.target.id);
                workItemsToPage.push(...childWorkItemIds);
            }

            let parentLinks = [];
            if (parentBacklogLevel) {
                const parentQueryResult: WitContracts.WorkItemQueryResult = yield call(_runParentWorkItemQuery, backlogLevelWorkItemIds, projectId, parentBacklogLevel);
                parentLinks = parentQueryResult ? parentQueryResult.workItemRelations : [];
            }

            parentWorkItemIds = parentLinks
                .filter(link => link.target && link.rel)
                .map((link) => link.target.id);
            workItemsToPage.push(...parentWorkItemIds);

            const workItems: WitContracts.WorkItem[] = yield call(_pageWorkItemFields, workItemsToPage, [orderField]);
            workItems.push(...pagedWorkItems);
            workItems.sort((w1, w2) => w1.fields[orderField] - w2.fields[orderField]);

            // Call action creators to update work items and links in the store
            yield put(workItemsReceived(workItems, parentWorkItemIds, backlogLevelWorkItemIds, childWorkItemIds));
            const linksReceived = childQueryResult ? childQueryResult.workItemRelations : [];
            linksReceived.push(...parentLinks);
            yield put(workItemLinksReceived(linksReceived));


            if (overriddenWorkItemIterations) {
                const currentValueTypes: IDictionaryNumberTo<IOverriddenIterationDuration> = JSON.parse(overriddenWorkItemIterations);

                for (const key in currentValueTypes) {
                    if (currentValueTypes.hasOwnProperty(key)) {
                        const workItemId = Number(key);
                        yield put(setOverrideIteration(
                            workItemId,
                            currentValueTypes[workItemId].startIterationId,
                            currentValueTypes[workItemId].endIterationId,
                            currentValueTypes[workItemId].user));
                    }
                }
            }
        }
    } catch (error) {
        yield put(genericError(error));
    }
}

function _escape(value: string): string {
    return value.replace("'", "''");
}

function _isInProgress(workItem: WitContracts.WorkItem, backlogConfig: Contracts.BacklogConfiguration) {
    return (backlogConfig.workItemTypeMappedStates.find((t) => t.workItemTypeName == workItem.fields["System.WorkItemType"]).states[workItem.fields["System.State"]] === "InProgress");
}

function _findChildBacklogLevel(
    backlogLevel: Contracts.BacklogLevelConfiguration,
    backlogConfig: Contracts.BacklogConfiguration):
    Contracts.BacklogLevelConfiguration {
    let childBacklogLevel = backlogConfig.portfolioBacklogs.find((level) => level.rank < backlogLevel.rank);
    if (childBacklogLevel) {
        return childBacklogLevel;
    }
    return backlogConfig.requirementBacklog;
}

function _findParentBacklogLevel(
    backlogLevel: Contracts.BacklogLevelConfiguration,
    backlogConfig: Contracts.BacklogConfiguration):
    Contracts.BacklogLevelConfiguration {

    let parentBacklogLevel = backlogConfig
        .portfolioBacklogs
        .filter((level) => level.rank > backlogLevel.rank)
        .sort((b1, b2) => b1.rank - b2.rank)[0];

    if (parentBacklogLevel) {
        return parentBacklogLevel;
    }
    return null;
}

async function _runChildWorkItemQuery(
    ids: number[],
    project: string,
    backlogLevel: Contracts.BacklogLevelConfiguration):
    Promise<WitContracts.WorkItemQueryResult> {
    if (!ids || ids.length === 0) {
        return Promise.resolve(null);
    }

    const idClause = ids.join(",");
    const witClause = backlogLevel.workItemTypes.map(wit => "'" + wit.name + "'").join(",");
    const wiql =
        `SELECT [System.Id]
     FROM WorkItemLinks 
     WHERE   (Source.[System.TeamProject] = @project and Source.[System.Id] in (${idClause})) 
         AND ([System.Links.LinkType] = 'System.LinkTypes.Hierarchy-Forward')
         AND (Target.[System.TeamProject] = @project and Target.[System.WorkItemType] in (${witClause}))  
     MODE (MayContain)`;
    const witHttpClient = VSS_Service.getClient(WorkItemTrackingHttpClient);
    return witHttpClient.queryByWiql({ query: wiql }, project);
}

async function _runParentWorkItemQuery(
    ids: number[],
    project: string,
    backlogLevel: Contracts.BacklogLevelConfiguration):
    Promise<WitContracts.WorkItemQueryResult> {
    if (!ids || ids.length === 0) {
        return Promise.resolve(null);
    }

    const idClause = ids.join(",");
    const witClause = backlogLevel.workItemTypes.map(wit => "'" + wit.name + "'").join(",");
    const wiql =
        `SELECT [System.Id]
     FROM WorkItemLinks 
     WHERE   (Source.[System.TeamProject] = @project and Source.[System.Id] in (${idClause})) 
         AND ([System.Links.LinkType] = 'System.LinkTypes.Hierarchy-Reverse')
         AND (Target.[System.TeamProject] = @project and Target.[System.WorkItemType] in (${witClause}))  
     MODE (MayContain)`;
    const witHttpClient = VSS_Service.getClient(WorkItemTrackingHttpClient);
    return witHttpClient.queryByWiql({ query: wiql }, project);
}

async function _pageWorkItemFields(
    ids: number[],
    fields: string[]): Promise<WitContracts.WorkItem[]> {
    if (!ids || ids.length === 0) {
        return Promise.resolve([]);
    }

    const commonFields = [
        "System.Id",
        "System.Title",
        "System.State",
        "System.WorkItemType",
        "System.IterationPath"
    ];
    commonFields.push(...fields);
    const witHttpClient = VSS_Service.getClient(WorkItemTrackingHttpClient);
    return witHttpClient.getWorkItems(ids, commonFields);
}
