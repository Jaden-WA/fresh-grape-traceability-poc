// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @title ActorRegistry
/// @notice Registers the five PoC participant types and enforces enrolment rules.
contract ActorRegistry {
    enum Role {
        None,
        Administrator,
        Producer,
        Transporter,
        Retailer,
        Regulator
    }

    struct Actor {
        Role role;
        bool active;
        uint64 registeredAt;
        address registeredBy;
    }

    address public immutable systemAdministrator;
    mapping(address account => Actor actor) private actors;

    event ActorRegistered(
        address indexed account,
        Role indexed role,
        address indexed registeredBy,
        uint64 registeredAt
    );
    event ActorRoleUpdated(address indexed account, Role indexed oldRole, Role indexed newRole);
    event ActorStatusChanged(address indexed account, bool active);

    error ZeroAddress();
    error InvalidRole();
    error ActorAlreadyRegistered(address account);
    error ActorNotRegistered(address account);
    error NotAdministrator(address caller);
    error NotEnrolmentAuthority(address caller);
    error RoleAssignmentNotAllowed(address caller, Role role);
    error SystemAdministratorProtected();
    error StatusUnchanged(address account, bool active);

    constructor() {
        systemAdministrator = msg.sender;
        uint64 registeredAt = uint64(block.timestamp);
        actors[msg.sender] = Actor({
            role: Role.Administrator,
            active: true,
            registeredAt: registeredAt,
            registeredBy: msg.sender
        });
        emit ActorRegistered(msg.sender, Role.Administrator, msg.sender, registeredAt);
    }

    modifier onlyAdministrator() {
        if (!hasRole(msg.sender, Role.Administrator)) {
            revert NotAdministrator(msg.sender);
        }
        _;
    }

    modifier onlyEnrolmentAuthority() {
        if (!isEnrolmentAuthority(msg.sender)) {
            revert NotEnrolmentAuthority(msg.sender);
        }
        _;
    }

    /// @notice Enrols a participant. Regulators may enrol operational actors,
    /// but only an administrator may create another regulator or administrator.
    function registerActor(address account, Role role) external onlyEnrolmentAuthority {
        if (account == address(0)) revert ZeroAddress();
        if (role == Role.None) revert InvalidRole();
        if (actors[account].registeredAt != 0) revert ActorAlreadyRegistered(account);

        Role callerRole = actors[msg.sender].role;
        if (
            callerRole == Role.Regulator &&
            (role == Role.Administrator || role == Role.Regulator)
        ) {
            revert RoleAssignmentNotAllowed(msg.sender, role);
        }

        uint64 registeredAt = uint64(block.timestamp);
        actors[account] = Actor({
            role: role,
            active: true,
            registeredAt: registeredAt,
            registeredBy: msg.sender
        });
        emit ActorRegistered(account, role, msg.sender, registeredAt);
    }

    /// @notice Changes an existing participant's role.
    function updateRole(address account, Role newRole) external onlyAdministrator {
        if (account == address(0)) revert ZeroAddress();
        if (newRole == Role.None) revert InvalidRole();
        if (account == systemAdministrator) revert SystemAdministratorProtected();

        Actor storage actor = actors[account];
        if (actor.registeredAt == 0) revert ActorNotRegistered(account);

        Role oldRole = actor.role;
        if (oldRole == newRole) revert RoleAssignmentNotAllowed(msg.sender, newRole);
        actor.role = newRole;
        emit ActorRoleUpdated(account, oldRole, newRole);
    }

    /// @notice Suspends or restores a participant without deleting audit history.
    function setActorActive(address account, bool active) external onlyAdministrator {
        if (account == systemAdministrator && !active) {
            revert SystemAdministratorProtected();
        }

        Actor storage actor = actors[account];
        if (actor.registeredAt == 0) revert ActorNotRegistered(account);
        if (actor.active == active) revert StatusUnchanged(account, active);

        actor.active = active;
        emit ActorStatusChanged(account, active);
    }

    function getActor(address account) external view returns (Actor memory) {
        Actor memory actor = actors[account];
        if (actor.registeredAt == 0) revert ActorNotRegistered(account);
        return actor;
    }

    function roleOf(address account) external view returns (Role) {
        return actors[account].role;
    }

    function isActive(address account) public view returns (bool) {
        return actors[account].active;
    }

    function hasRole(address account, Role role) public view returns (bool) {
        Actor memory actor = actors[account];
        return actor.active && actor.role == role;
    }

    function isEnrolmentAuthority(address account) public view returns (bool) {
        Actor memory actor = actors[account];
        return
            actor.active &&
            (actor.role == Role.Administrator || actor.role == Role.Regulator);
    }
}
