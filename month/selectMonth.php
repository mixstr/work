<?php
    require_once(dirname(__DIR__) . '/configDB.php');
    $sql = file_get_contents(dirname(__DIR__) . '/sql/selectMonth.sql');
    $query = $databasehandler->query($sql);
    foreach ($query as $row){
        print "<br/>";
        print $row['id'] . '-' . $row['name'] . '-' . $row['day'] . '-' . $row['month'] . $row['year'] . '<br/>';
    }
?>