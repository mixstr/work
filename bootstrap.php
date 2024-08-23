<?php

require_once "vendor/autoload.php";

use Doctrine\ORM\EntityManager;
use Doctrine\ORM\ORMSetup;
use Doctrine\DBAL\DriverManager;


function callEntityManager(): EntityManager
{
    $paths = array(__DIR__ . "/Entities");
    require_once "dataBaseconst.php";

    $conn = DriverManager::getConnection(DATADB);


    $config = ORMSetup::createAttributeMetadataConfiguration($paths, true);
    return $entityManager = new EntityManager($conn, $config);
}