import * as React from 'react';
import configureStore from '../../redux/configureStore';
import DraggableWorkItemRenderer from './WorkItem/DraggableWorkItemRenderer';
import HTML5Backend from 'react-dnd-html5-backend';
import {
    changeDisplayIterationCount,
    displayAllIterations,
    shiftDisplayIterationLeft,
    shiftDisplayIterationRight
} from '../../redux/store/teamiterations/actionCreators';
import { clearOverrideIteration, launchWorkItemForm, startUpdateWorkItemIteration } from '../../redux/store/workitems/actionCreators';
import { closeDetails, createInitialize, showDetails } from '../../redux/store/common/actioncreators';
import { connect, Provider } from 'react-redux';
import { DragDropContext } from 'react-dnd';
import { endOverrideIteration, overrideHoverOverIteration, startOverrideIteration } from '../../redux/store/overrideIterationProgress/actionCreators';
import {
    getBacklogLevel,
    getProjectId,
    getRawState,
    getTeamId,
    gridViewSelector,
    uiStatusSelector
} from '../../redux/selectors';
import { getRowColumnStyle, getTemplateColumns } from './gridhelper';
import { IFeatureTimelineRawState, IWorkItemOverrideIteration } from '../../redux/store';
import { IGridView } from '../../redux/selectors/gridViewSelector';
import { IterationDropTarget } from './DroppableIterationShadow';
import { IterationRenderer } from './IterationRenderer';
import { MessageBar, MessageBarType } from 'office-ui-fabric-react/lib/MessageBar';
import { Spinner, SpinnerSize } from 'office-ui-fabric-react/lib/Spinner';
import { TeamSettingsIteration } from 'TFS/Work/Contracts';
import { TimelineDialog } from './TimelineDialog';
import { UIStatus } from '../../redux/types';
import { WorkitemGap } from './WorkItem/WorkItemGap';
import { WorkItemShadow } from './WorkItem/WorkItemShadow';
import './FeatureTimelineGrid.scss';

export interface IFeatureTimelineGridProps {
    projectId: string;
    teamId: string;
    rawState: IFeatureTimelineRawState;
    uiState: UIStatus;
    gridView: IGridView,
    childItems: number[];
    launchWorkItemForm: (id: number) => void;
    showDetails: (id: number) => void;
    closeDetails: (id: number) => void;
    clearOverrideIteration: (id: number) => void;
    dragHoverOverIteration: (iteration: string) => void;
    overrideIterationStart: (payload: IWorkItemOverrideIteration) => void;
    overrideIterationEnd: () => void;
    changeIteration: (id: number, teamIteration: TeamSettingsIteration, override: boolean) => void;
    showThreeIterations: (projectId: string, teamId: string) => void;
    showFiveIterations: (projectId: string, teamId: string) => void;
    shiftDisplayIterationLeft: () => void;
    shiftDisplayIterationRight: () => void;
    showAllIterations: () => void;
}

const makeMapStateToProps = () => {
    return (state: IFeatureTimelineRawState) => {
        return {
            projectId: getProjectId(),
            teamId: getTeamId(),
            rawState: getRawState(state),
            uiState: uiStatusSelector()(state),
            gridView: gridViewSelector()(state),
            childItems: state.workItemDetails
        }
    }
}

const mapDispatchToProps = (dispatch) => {
    return {
        launchWorkItemForm: (id: number) => {
            if (id) {
                dispatch(launchWorkItemForm(id));
            }
        },
        showDetails: (id: number) => {
            dispatch(showDetails(id));
        },
        closeDetails: (id: number) => {
            dispatch(closeDetails(id));
        },
        dragHoverOverIteration: (iterationId: string) => {
            dispatch(overrideHoverOverIteration(iterationId));
        },
        overrideIterationStart: (payload: IWorkItemOverrideIteration) => {
            dispatch(startOverrideIteration(payload));
        },
        overrideIterationEnd: () => {
            dispatch(endOverrideIteration());
        },
        clearOverrideIteration: (id: number) => {
            dispatch(clearOverrideIteration(id));
        },
        changeIteration: (id: number, teamIteration: TeamSettingsIteration, override: boolean) => {
            dispatch(startUpdateWorkItemIteration([id], teamIteration, override));
        },
        showThreeIterations: (projectId: string, teamId: string) => {
            dispatch(changeDisplayIterationCount(3, projectId, teamId));
        },
        showFiveIterations: (projectId: string, teamId: string) => {
            dispatch(changeDisplayIterationCount(5, projectId, teamId));
        },
        showAllIterations: () => {
            dispatch(displayAllIterations());
        },
        shiftDisplayIterationLeft: () => {
            dispatch(shiftDisplayIterationLeft(1));
        },
        shiftDisplayIterationRight: () => {
            dispatch(shiftDisplayIterationRight(1));
        }

    };
};

interface IFeatureTimelineGridState {
    collapsedGroups: IDictionaryNumberTo<boolean>;
}

export class FeatureTimelineGrid extends React.Component<IFeatureTimelineGridProps, IFeatureTimelineGridState> {
    constructor() {
        super();
        this.state = {
            collapsedGroups: {}
        };
    }

    public render(): JSX.Element {

        const {
            uiState,
            projectId,
            teamId
        } = this.props;
        if (!this.props.rawState || uiState === UIStatus.Loading) {
            return (
                <Spinner size={SpinnerSize.large} label="Loading..." />
            );
        }

        if (this.props.rawState.error) {
            return (
                <MessageBar
                    messageBarType={MessageBarType.error}
                    isMultiline={false}
                >
                    {this.props.rawState.error}
                </MessageBar>
            );
        }

        if (uiState === UIStatus.NoTeamIterations) {
            return (
                <MessageBar
                    messageBarType={MessageBarType.error}
                    isMultiline={false}
                >
                    {"The team does not have any iteration selected, please visit team admin page and select team iterations."}
                </MessageBar>
            );
        }

        if (uiState === UIStatus.NoWorkItems) {
            return (<MessageBar
                messageBarType={MessageBarType.info}
                isMultiline={false}
            >
                {"No in-progress Features for the timeline."}
            </MessageBar>);
        }

        const {
            emptyHeaderRow,
            iterationHeader,
            iterationShadow,
            workItems,
            workItemShadow,
            iterationDisplayOptions,
            isSubGrid
        } = this.props.gridView;

        const columnHeading = iterationHeader.map((iteration, index) => {
            const style = getRowColumnStyle(iteration.dimension);
            return (
                <div className="columnheading" style={style}>
                    <IterationRenderer iteration={iteration.teamIteration} />
                </div>
            );

        });

        const shadows = iterationShadow.map((shadow, index) => {
            return (
                <IterationDropTarget
                    {...shadow}
                    isOverrideIterationInProgress={!!this.props.rawState.workItemOverrideIteration}
                    onOverrideIterationOver={this.props.dragHoverOverIteration.bind(this)}
                    changeIteration={this.props.changeIteration.bind(this)}
                >
                    &nbsp;
                </IterationDropTarget>
            );
        });

        let workItemShadowCell = null;
        if (workItemShadow) {
            const workItem = workItems.filter(w => !w.isGap && w.workItem.id === workItemShadow)[0];
            workItemShadowCell = (
                <WorkItemShadow {...workItem.dimension} />
            );
        }

        const workItemCells = workItems.filter(w => !w.isGap && w.workItem.id).map(w => {
            return (
                <DraggableWorkItemRenderer
                    id={w.workItem.id}
                    title={w.workItem.title}
                    color={w.workItem.color}
                    isRoot={w.workItem.isRoot}
                    iterationDuration={w.workItem.iterationDuration}
                    dimension={w.dimension}
                    onClick={id => this.props.launchWorkItemForm(id)}
                    shouldShowDetails={w.workItem.shouldShowDetails}
                    showDetails={id => this.props.showDetails(id)}
                    overrideIterationStart={payload => this.props.overrideIterationStart(payload)}
                    overrideIterationEnd={() => this.props.overrideIterationEnd()}
                    allowOverride={!this.props.gridView.isSubGrid}
                    crop={w.crop}
                />
            );
        });

        const workItemGaps = workItems.filter(w => w.isGap).map(w => {
            return (
                <WorkitemGap {...w.dimension} />
            );
        });


        const extraColumns = this.props.gridView.hideParents ? [] : ['minmax(100px, 10%)'];
        const gridStyle = getTemplateColumns(extraColumns, shadows.length, 'minmax(10%, 400px)');

        let childDialog = null;
        if (this.props.childItems.length > 0) {
            const props = { ...this.props, id: this.props.childItems[0] };
            childDialog = <TimelineDialog {...props} />
        }

        let leftButton = <span className="non-button"></span>;
        if (iterationDisplayOptions && iterationDisplayOptions.startIndex > 0) {
            leftButton = <span className="button" onClick={() => this.props.shiftDisplayIterationLeft()}>{"<<"}</span>;
        }

        let rightButton = <span className="non-button"></span>;
        if (iterationDisplayOptions && iterationDisplayOptions.endIndex < (iterationDisplayOptions.totalIterations - 1)) {
            rightButton = <span className="button" onClick={() => this.props.shiftDisplayIterationRight()}>{">>"}</span>
        }

        let displayOptions = null;
        let commandHeading = [];

        if (!isSubGrid && (iterationDisplayOptions || columnHeading.length > 3)) {
            displayOptions = (
                <div className="iteration-options">
                    <span className="command" onClick={() => this.props.showThreeIterations(projectId, teamId)}>Show three Sprints</span>
                    <span className="command" onClick={() => this.props.showFiveIterations(projectId, teamId)}>Show five Sprints</span>
                    <span className="command" onClick={() => this.props.showAllIterations()}>Show all sprints</span>
                </div>
            );

            if (emptyHeaderRow.length === 1) {
                // Special case only one column
                let rowColumnStyle = getRowColumnStyle(emptyHeaderRow[0]);
                const commands = (
                    <div style={rowColumnStyle} className="single-column-commands">
                        <div className="command-left-section">
                            {leftButton}
                        </div>
                        <div className="command-right-section">
                            {rightButton}
                        </div>
                    </div>
                );

                commandHeading.push(commands);

            } else {
                // Add left button to first empty heading cell
                let rowColumnStyle = getRowColumnStyle(emptyHeaderRow[0]);
                const firstHeaderColumnCommand = (
                    <div style={rowColumnStyle} className="first-header-column-command">
                        {leftButton}
                    </div>
                );
                commandHeading.push(firstHeaderColumnCommand);

                // Add display options and right button on last empty heading cell
                rowColumnStyle = getRowColumnStyle(emptyHeaderRow[emptyHeaderRow.length - 1]);
                const lastHeaderColumnCommand = (
                    <div style={rowColumnStyle} className="last-header-column-command">
                        {rightButton}
                    </div>
                );
                commandHeading.push(lastHeaderColumnCommand);
            }
        }

        return (
            <div className="root-container">
                {displayOptions}
                <div className="feature-timeline-main-container">
                    <div className="container" style={gridStyle}>
                        {commandHeading}
                        {columnHeading}
                        {shadows}
                        {workItemShadowCell}
                        {workItemCells}
                        {workItemGaps}
                        {childDialog}
                    </div>
                </div>
            </div>
        );
    }
}

const ConntectedFeatureTimeline = connect(
    makeMapStateToProps, mapDispatchToProps
)(FeatureTimelineGrid);

export const PrimaryGrid = () => {
    const initialState: IFeatureTimelineRawState = {
        loading: true
    } as IFeatureTimelineRawState;
    const store = configureStore(initialState);

    const projectId = getProjectId();
    const teamId = getTeamId();
    const backlogLevel = getBacklogLevel();

    const action = createInitialize(projectId, teamId, backlogLevel);
    store.dispatch(action);

    return (
        <Provider store={store}>
            <ConntectedFeatureTimeline />
        </Provider>);
}

export const DragDropGrid = DragDropContext(HTML5Backend)(PrimaryGrid);