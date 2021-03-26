// SPDX-License-Identifier: GPL-3.0

pragma solidity 0.6.8;

contract ZoraProxyStorage {
    address public implementation;
    address public admin;

    modifier onlyAdmin() {
        require(
            admin == msg.sender,
            "ZoraProxyStorage: only admin"
        );
        _;
    }
}