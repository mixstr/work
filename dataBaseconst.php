<?php

$connectionParams = array(
        "driver" => "pdo_pgsql",
        "host" => "127.0.0.1",
        "dbname" => "postgres",
        "user" => "postgres",
        "password" => "123456",
        "port" => 5432
    );

define('DATADB',$connectionParams, TRUE);